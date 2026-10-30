/**
 * Identity advertised to MCP clients during initialisation.
 */
export const MCP_SERVER_NAME = 'documenso';
export const MCP_SERVER_TITLE = 'Documenso';
export const MCP_SERVER_VERSION = '1.0.0';

/**
 * Path the Streamable HTTP transport is mounted on, relative to the web app URL.
 */
export const MCP_PATH = '/api/mcp';

/**
 * RFC 9728 protected resource metadata well-known path. The path-suffix form
 * (`/.well-known/oauth-protected-resource/api/mcp`) is also served.
 */
export const MCP_PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/**
 * URI scheme used for MCP resources exposed by this server.
 */
export const MCP_RESOURCE_URI_SCHEME = 'documenso';

/**
 * Upper bound for a single JSON-RPC POST body. Large enough for a base64
 * encoded PDF at the document upload size limit.
 */
export const MCP_MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Idle time after which an in-memory MCP session is discarded.
 */
export const MCP_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Largest PDF returned inline (base64) when a tool is asked for `inline: true`.
 */
export const MCP_INLINE_PDF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Documentation page linked from the protected resource metadata and server instructions.
 */
export const MCP_DOCUMENTATION_PATH = '/docs/developers/mcp';
