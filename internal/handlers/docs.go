package handlers

import (
	_ "embed"
	"fmt"
	"net/http"
	"strings"
)

//go:embed docs.md
var embeddedDocs []byte

// ServeDocsPage serves the API reference as plain Markdown.
// A small "This instance" header with live values is prepended to the
// embedded static docs.md file.
func (h *Handler) ServeDocsPage(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	base := fmt.Sprintf("%s://%s", scheme, r.Host)

	dirs := h.registry.List()
	dirStr := strings.Join(dirs, ", ")
	if dirStr == "" {
		dirStr = "(none registered)"
	}

	header := fmt.Sprintf(`# VibeDiff API Reference

## This instance

| Property     | Value          |
|--------------|----------------|
| Base URL     | %s             |
| Projects     | %s             |
| UI           | %s/            |
| MCP endpoint | %s/mcp         |

`, base, dirStr, base, base)

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	fmt.Fprint(w, header)

	// Strip the leading "# VibeDiff API Reference\n\n" from the embedded
	// file since the dynamic header already includes it.
	body := embeddedDocs
	const title = "# VibeDiff API Reference\n\n"
	if len(body) > len(title) && string(body[:len(title)]) == title {
		body = body[len(title):]
	}
	_, _ = w.Write(body)
}
