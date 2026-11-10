// Package httpapi exposes the profile store over HTTP for internal callers
// (the Lambda backend). It has no authentication: keep it on a private network.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/my-better-t-app/go-api/internal/profiles"
)

const (
	maxBodyBytes = 1 << 20
	queryTimeout = 5 * time.Second
	pingTimeout  = 2 * time.Second
)

// ProfileService is the subset of profiles.Repository the handlers use.
type ProfileService interface {
	Get(ctx context.Context, id string) (profiles.Profile, error)
	List(ctx context.Context, params profiles.ListParams) (profiles.Page, error)
	Create(ctx context.Context, input profiles.NewProfile) (profiles.Profile, error)
}

// Pinger checks database connectivity for the readiness probe.
type Pinger interface {
	Ping(ctx context.Context) error
}

type handler struct {
	profiles ProfileService
	db       Pinger
	logger   *slog.Logger
}

// NewHandler returns the routed, middleware-wrapped HTTP handler.
func NewHandler(svc ProfileService, db Pinger, logger *slog.Logger) http.Handler {
	h := &handler{profiles: svc, db: db, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("GET /ready", h.ready)
	mux.HandleFunc("GET /profiles", h.listProfiles)
	mux.HandleFunc("GET /profiles/{id}", h.getProfile)
	mux.HandleFunc("POST /profiles", h.createProfile)
	return recoverPanics(logger, logRequests(logger, mux))
}

// health is the liveness probe: it never touches the database, so a database
// outage does not make ECS replace otherwise healthy tasks.
func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ready reports whether the database is reachable.
func (h *handler) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
	defer cancel()
	if err := h.db.Ping(ctx); err != nil {
		h.logger.WarnContext(ctx, "readiness check failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "UNAVAILABLE", "数据库不可用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (h *handler) listProfiles(w http.ResponseWriter, r *http.Request) {
	params, err := parseListParams(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	page, err := h.profiles.List(ctx, params)
	if err != nil {
		h.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func parseListParams(r *http.Request) (profiles.ListParams, error) {
	query := r.URL.Query()
	params := profiles.ListParams{
		Keyword: strings.TrimSpace(query.Get("keyword")),
		Sort:    profiles.SortCreatedAt,
		Cursor:  query.Get("cursor"),
		Limit:   profiles.DefaultPageSize,
	}
	if utf8.RuneCountInString(params.Keyword) > profiles.MaxKeywordLength {
		return params, errors.New("关键字过长")
	}
	if raw := query.Get("sort"); raw != "" {
		params.Sort = profiles.Sort(raw)
		if !params.Sort.Valid() {
			return params, errors.New("sort 只能是 createdAt、followers 或 publicRepos")
		}
	}
	if raw := query.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > profiles.MaxPageSize {
			return params, errors.New("limit 必须是 1 到 50 之间的整数")
		}
		params.Limit = limit
	}
	return params, nil
}

func (h *handler) getProfile(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	profile, err := h.profiles.Get(ctx, r.PathValue("id"))
	if errors.Is(err, profiles.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "该人员不存在")
		return
	}
	if err != nil {
		h.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *handler) createProfile(w http.ResponseWriter, r *http.Request) {
	var input profiles.NewProfile
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求体不是有效的 JSON")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "请求体只能包含一个 JSON 对象")
		return
	}
	if err := input.Normalize(); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	profile, err := h.profiles.Create(ctx, input)
	if errors.Is(err, profiles.ErrDuplicate) {
		writeError(w, http.StatusConflict, "CONFLICT", "该用户已在系统中")
		return
	}
	if err != nil {
		h.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, profile)
}

func (h *handler) internalError(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "服务器内部错误")
}

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorDetail{Code: code, Message: message}})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// The status line is already sent; an encode error can only be a broken connection.
	_ = json.NewEncoder(w).Encode(body)
}
