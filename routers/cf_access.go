// Copyright 2026 The Casdoor Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package routers

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/beego/beego/v2/core/logs"
	"github.com/beego/beego/v2/server/web/context"
	"github.com/golang-jwt/jwt/v5"
)

// Cloudflare Access auto-signin: when a request carries a valid
// Cf-Access-Jwt-Assertion JWT issued by the configured team domain, matching
// the configured AUD and one of the configured admin e-mails, the request is
// treated as signed in as "built-in/admin" without a password or session.
//
// Configuration (all three required, otherwise the feature is disabled):
//   CASDOOR_CF_ACCESS_TEAM_DOMAIN   e.g. "my-team.cloudflareaccess.com"; a value
//                                   with an explicit scheme is allowed for tests
//   CASDOOR_CF_ACCESS_AUD           the Access application audience tag
//   CASDOOR_CF_ACCESS_ADMIN_EMAILS  comma-separated allowed e-mails

const (
	cfAccessJwtHeader = "Cf-Access-Jwt-Assertion"
	cfAccessJwksPath  = "/cdn-cgi/access/certs"
	cfAccessJwksTTL   = time.Hour
)

type cfAccessJwksData struct {
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

var (
	cfAccessJwksMu sync.Mutex
	cfAccessJwks   *cfAccessJwksData
)

var cfAccessAdminEmailsOnce sync.Once
var cfAccessAdminEmails map[string]bool

func resolveCfAccessBase(teamDomain string) string {
	if strings.Contains(teamDomain, "://") {
		return strings.TrimSuffix(teamDomain, "/")
	}
	return "https://" + strings.TrimSuffix(teamDomain, "/")
}

func cfAccessEmailAllowed(email string) bool {
	cfAccessAdminEmailsOnce.Do(func() {
		cfAccessAdminEmails = map[string]bool{}
		for _, raw := range strings.Split(os.Getenv("CASDOOR_CF_ACCESS_ADMIN_EMAILS"), ",") {
			raw = strings.ToLower(strings.TrimSpace(raw))
			if raw != "" {
				cfAccessAdminEmails[raw] = true
			}
		}
	})
	return cfAccessAdminEmails[strings.ToLower(strings.TrimSpace(email))]
}

func fetchCfAccessJwks(base string) (map[string]*rsa.PublicKey, error) {
	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(base + cfAccessJwksPath)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching CF Access certs: status %d", resp.StatusCode)
	}

	payload := struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}{}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	keys := map[string]*rsa.PublicKey{}
	for _, key := range payload.Keys {
		if key.Kty != "RSA" || key.Kid == "" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
		if err != nil {
			continue
		}
		eInt := new(big.Int).SetBytes(eBytes)
		if !eInt.IsInt64() {
			continue
		}
		e := int(eInt.Int64())
		if e <= 0 {
			continue
		}
		keys[key.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
	}
	if len(keys) == 0 {
		return nil, errors.New("CF Access certs: no usable RSA keys")
	}
	return keys, nil
}

func getCfAccessJwks(base string) (map[string]*rsa.PublicKey, error) {
	cfAccessJwksMu.Lock()
	defer cfAccessJwksMu.Unlock()

	if cfAccessJwks != nil && time.Since(cfAccessJwks.fetchedAt) < cfAccessJwksTTL {
		return cfAccessJwks.keys, nil
	}
	keys, err := fetchCfAccessJwks(base)
	if err != nil {
		return nil, err
	}
	cfAccessJwks = &cfAccessJwksData{keys: keys, fetchedAt: time.Now()}
	return keys, nil
}

func getCfAccessKey(base, rawToken string) (*rsa.PublicKey, error) {
	kid, err := cfAccessTokenKid(rawToken)
	if err != nil {
		return nil, err
	}

	keys, err := getCfAccessJwks(base)
	if err == nil {
		if key, ok := keys[kid]; ok {
			return key, nil
		}
		// unknown kid: the edge may have rotated keys, refetch once
		keys, err = fetchCfAccessJwks(base)
		if err != nil {
			return nil, err
		}
		cfAccessJwksMu.Lock()
		cfAccessJwks = &cfAccessJwksData{keys: keys, fetchedAt: time.Now()}
		cfAccessJwksMu.Unlock()
		if key, ok := keys[kid]; ok {
			return key, nil
		}
		return nil, fmt.Errorf("CF Access certs: unknown kid %q", kid)
	}

	// cache absent or previous fetch failed: retry once, ignore stale cache
	keys, err = fetchCfAccessJwks(base)
	if err != nil {
		return nil, err
	}
	key, ok := keys[kid]
	if !ok {
		return nil, fmt.Errorf("CF Access certs: unknown kid %q", kid)
	}
	return key, nil
}

func cfAccessTokenKid(rawToken string) (string, error) {
	parser := jwt.NewParser()
	token, _, err := parser.ParseUnverified(rawToken, jwt.MapClaims{})
	if err != nil {
		return "", fmt.Errorf("parsing CF Access JWT header: %w", err)
	}
	kid, _ := token.Header["kid"].(string)
	if kid == "" {
		return "", errors.New("CF Access JWT has no kid")
	}
	return kid, nil
}

func cfAccessValidate(rawToken string) (string, error) {
	teamDomain := strings.TrimSpace(os.Getenv("CASDOOR_CF_ACCESS_TEAM_DOMAIN"))
	aud := strings.TrimSpace(os.Getenv("CASDOOR_CF_ACCESS_AUD"))
	if teamDomain == "" || aud == "" {
		return "", errors.New("CF Access auto-signin is not configured")
	}
	base := resolveCfAccessBase(teamDomain)

	key, err := getCfAccessKey(base, rawToken)
	if err != nil {
		return "", err
	}

	claims := jwt.MapClaims{}
	token, err := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(base),
		jwt.WithAudience(aud),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(1*time.Minute),
	).ParseWithClaims(rawToken, claims, func(*jwt.Token) (interface{}, error) {
		return key, nil
	})
	if err != nil {
		return "", err
	}
	if !token.Valid {
		return "", errors.New("CF Access JWT is not valid")
	}

	email, _ := claims["email"].(string)
	if email == "" {
		return "", errors.New("CF Access JWT has no email claim")
	}
	return email, nil
}

// cfAccessAdminSubject returns "built-in/admin" when the request carries a valid
// CF Access JWT whose e-mail is allowlisted, or "" when it does not.
func cfAccessAdminSubject(ctx *context.Context) string {
	rawToken := ctx.Request.Header.Get(cfAccessJwtHeader)
	if rawToken == "" {
		return ""
	}

	email, err := cfAccessValidate(rawToken)
	if err != nil {
		logs.Error("CF-Access auto-signin rejected a token: %s", err.Error())
		return ""
	}
	if !cfAccessEmailAllowed(email) {
		logs.Error("CF-Access auto-signin: e-mail %s is not in the allowlist", email)
		return ""
	}
	return "built-in/admin"
}
