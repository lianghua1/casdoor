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

package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// GetQuantUserAssets
// @Title GetQuantUserAssets
// @Tag System API
// @Description proxy a Quant Host user's assets (factors, strategies, AI key usage); global admins only
// @Param   name query string true "Casdoor user name or email"
// @Success 200 {object} controllers.Response The Response object
// @router /get-quant-user-assets [get]
func (c *ApiController) GetQuantUserAssets() {
	if !c.requireGlobalAdmin() {
		return
	}

	name := strings.TrimSpace(c.Ctx.Input.Query("name"))
	if name == "" {
		c.ResponseError("缺少用户标识（name 或 email）。")
		return
	}

	baseUrl := strings.TrimRight(strings.TrimSpace(os.Getenv("QUANT_HOST_ASSETS_URL")), "/")
	token := strings.TrimSpace(os.Getenv("QUANT_HOST_ASSETS_TOKEN"))
	if baseUrl == "" || token == "" {
		c.ResponseError("Quant Host 集成未配置（缺少 QUANT_HOST_ASSETS_URL / QUANT_HOST_ASSETS_TOKEN）。")
		return
	}

	endpoint := fmt.Sprintf("%s/api/integrations/casdoor/users/%s/assets", baseUrl, url.PathEscape(name))
	req, err := http.NewRequestWithContext(c.Ctx.Request.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.ResponseError("无法连接 Quant Host：" + err.Error())
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	if resp.StatusCode == http.StatusNotFound {
		c.ResponseOk(map[string]interface{}{"linked": false})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.ResponseError(fmt.Sprintf("Quant Host 返回 %d：%s", resp.StatusCode, strings.TrimSpace(string(body))))
		return
	}

	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		c.ResponseError("Quant Host 返回了无法解析的数据。")
		return
	}
	c.ResponseOk(map[string]interface{}{"linked": true, "assets": payload})
}

// GetQuantUserChat
// @Title GetQuantUserChat
// @Tag System API
// @Description proxy one Quant Host user's OWUI conversation (title + messages); global admins only
// @Param   name   query string true "Casdoor user name or email"
// @Param   chatId query string true "OWUI chat id"
// @Success 200 {object} controllers.Response The Response object
// @router /get-quant-user-chat [get]
func (c *ApiController) GetQuantUserChat() {
	if !c.requireGlobalAdmin() {
		return
	}

	name := strings.TrimSpace(c.Ctx.Input.Query("name"))
	chatId := strings.TrimSpace(c.Ctx.Input.Query("chatId"))
	if name == "" || chatId == "" {
		c.ResponseError("缺少用户标识或对话标识。")
		return
	}

	baseUrl := strings.TrimRight(strings.TrimSpace(os.Getenv("QUANT_HOST_ASSETS_URL")), "/")
	token := strings.TrimSpace(os.Getenv("QUANT_HOST_ASSETS_TOKEN"))
	if baseUrl == "" || token == "" {
		c.ResponseError("Quant Host 集成未配置（缺少 QUANT_HOST_ASSETS_URL / QUANT_HOST_ASSETS_TOKEN）。")
		return
	}

	endpoint := fmt.Sprintf("%s/api/integrations/casdoor/users/%s/chats/%s", baseUrl, url.PathEscape(name), url.PathEscape(chatId))
	req, err := http.NewRequestWithContext(c.Ctx.Request.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		c.ResponseError(err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.ResponseError("无法连接 Quant Host：" + err.Error())
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		c.ResponseError(err.Error())
		return
	}

	if resp.StatusCode == http.StatusNotFound {
		c.ResponseError("对话不存在，或该用户没有对话数据源。")
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.ResponseError(fmt.Sprintf("Quant Host 返回 %d：%s", resp.StatusCode, strings.TrimSpace(string(body))))
		return
	}

	var payload interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		c.ResponseError("Quant Host 返回了无法解析的数据。")
		return
	}
	c.ResponseOk(payload)
}
