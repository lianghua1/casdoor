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
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func base64RawURL(n *big.Int) string {
	return base64.RawURLEncoding.EncodeToString(n.Bytes())
}

func base64RawURLInt(e int) string {
	return base64.RawURLEncoding.EncodeToString(big.NewInt(int64(e)).Bytes())
}

func makeTestJwksServer(t *testing.T, key *rsa.PublicKey, kid string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(cfAccessJwksPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"keys": []map[string]string{{
				"kid": kid,
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"n":   base64RawURL(key.N),
				"e":   base64RawURLInt(key.E),
			}},
		})
	})
	return httptest.NewServer(mux)
}

func signTestToken(t *testing.T, key *rsa.PrivateKey, kid, iss, aud, email string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"aud":   aud,
		"exp":   exp.Unix(),
		"iss":   iss,
		"email": email,
		"type":  "app",
	})
	tok.Header["kid"] = kid
	signed, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func TestCfAccessValidateHappyPath(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := makeTestJwksServer(t, &priv.PublicKey, "kid-1")
	defer srv.Close()
	defer func() { cfAccessJwks = nil }()

	t.Setenv("CASDOOR_CF_ACCESS_TEAM_DOMAIN", srv.URL)
	t.Setenv("CASDOOR_CF_ACCESS_AUD", "aud-test")
	t.Setenv("CASDOOR_CF_ACCESS_ADMIN_EMAILS", "Owner@Example.com")

	validUntil := time.Now().Add(10 * time.Minute)
	token := signTestToken(t, priv, "kid-1", srv.URL, "aud-test", "owner@example.com", validUntil)

	email, err := cfAccessValidate(token)
	if err != nil {
		t.Fatalf("expected valid, got error: %v", err)
	}
	if email != "owner@example.com" {
		t.Fatalf("unexpected email %q", email)
	}
	if !cfAccessEmailAllowed("OWNER@example.com ") {
		t.Fatal("allowlist must be case/space insensitive")
	}
	if cfAccessEmailAllowed("stranger@example.com") {
		t.Fatal("allowlist must reject foreign e-mails")
	}
}

func TestCfAccessValidateRejections(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	srv := makeTestJwksServer(t, &priv.PublicKey, "kid-1")
	defer srv.Close()
	defer func() { cfAccessJwks = nil }()

	t.Setenv("CASDOOR_CF_ACCESS_TEAM_DOMAIN", srv.URL)
	t.Setenv("CASDOOR_CF_ACCESS_AUD", "aud-test")
	t.Setenv("CASDOOR_CF_ACCESS_ADMIN_EMAILS", "owner@example.com")

	validUntil := time.Now().Add(10 * time.Minute)
	base := srv.URL

	cases := []struct {
		name  string
		token string
	}{
		{"wrong aud", signTestToken(t, priv, "kid-1", base, "other-aud", "owner@example.com", validUntil)},
		{"expired", signTestToken(t, priv, "kid-1", base, "aud-test", "owner@example.com", time.Now().Add(-time.Minute))},
		{"wrong kid", signTestToken(t, priv, "kid-9", base, "aud-test", "owner@example.com", validUntil)},
		{"wrong issuer", signTestToken(t, priv, "kid-1", "https://evil.example.com", "aud-test", "owner@example.com", validUntil)},
		{"no email", signTestToken(t, priv, "kid-1", base, "aud-test", "", validUntil)},
	}
	for _, c := range cases {
		if _, err := cfAccessValidate(c.token); err == nil {
			t.Errorf("case %q: expected error, got nil", c.name)
		}
	}
}

func TestResolveCfAccessBase(t *testing.T) {
	if got := resolveCfAccessBase("team.example.com/"); got != "https://team.example.com" {
		t.Fatalf("got %q", got)
	}
	if got := resolveCfAccessBase("http://127.0.0.1:8080"); got != "http://127.0.0.1:8080" {
		t.Fatalf("got %q", got)
	}
}

func TestCfAccessDisabledWithoutConfig(t *testing.T) {
	t.Setenv("CASDOOR_CF_ACCESS_TEAM_DOMAIN", "")
	t.Setenv("CASDOOR_CF_ACCESS_AUD", "")
	if _, err := cfAccessValidate("dummy"); err == nil {
		t.Fatal("expected disabled error when not configured")
	}
}
