export type AzureDevOpsDiagnosticStatus =
	| "host_unavailable"
	| "not_configured"
	| "cli_missing"
	| "extension_missing"
	| "authentication_required"
	| "access_denied"
	| "repository_not_found"
	| "network_error"
	| "timeout"
	| "command_failed"
	| "ready";
