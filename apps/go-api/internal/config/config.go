// Package config reads service settings from environment variables, which
// ECS injects from the task definition (secrets from Secrets Manager / SSM).
package config

import (
	"errors"
	"os"
	"strconv"
)

const defaultPort = 8080

// Config holds runtime settings.
type Config struct {
	Port        int
	DatabaseURL string
}

// Load reads PORT (default 8080) and DATABASE_URL (required).
func Load() (Config, error) {
	cfg := Config{Port: defaultPort, DatabaseURL: os.Getenv("DATABASE_URL")}
	if cfg.DatabaseURL == "" {
		return cfg, errors.New("DATABASE_URL is required")
	}
	if raw := os.Getenv("PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return cfg, errors.New("PORT must be an integer between 1 and 65535")
		}
		cfg.Port = port
	}
	return cfg, nil
}

// PortFromEnv returns PORT or the default, for the healthcheck subcommand,
// which must not require DATABASE_URL.
func PortFromEnv() int {
	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil || port < 1 || port > 65535 {
		return defaultPort
	}
	return port
}
