/**
 * Client for Copilot Studio's Direct Line "token endpoint" (the URL copied from
 * Copilot Studio > Channels > Mobile app / Custom website). Calling this endpoint
 * with GET mints a short-lived Direct Line token (and, on first call, a new
 * conversationId) without ever exposing the underlying Direct Line secret.
 */

export interface DirectLineTokenResponse {
    token: string;
    conversationId?: string;
    expires_in?: number;
    streamUrl?: string;
}

export class TokenEndpointError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = "TokenEndpointError";
    }
}

/**
 * Fetches a fresh Direct Line token from the Copilot Studio token endpoint.
 * @param tokenEndpoint The full token endpoint URL (the "connection string").
 */
export async function fetchDirectLineToken(tokenEndpoint: string): Promise<DirectLineTokenResponse> {
    if (!tokenEndpoint || tokenEndpoint.trim().length === 0) {
        throw new TokenEndpointError("No connection string / token endpoint URL was provided.");
    }

    let response: Response;
    try {
        response = await fetch(tokenEndpoint, {
            method: "GET",
            headers: {
                Accept: "application/json"
            }
        });
    } catch (networkError) {
        const detail = networkError instanceof Error ? networkError.message : String(networkError);
        throw new TokenEndpointError(
            `Could not reach the token endpoint. This is usually a CORS/network problem or an ` +
                `invalid URL. Details: ${detail}`
        );
    }

    if (!response.ok) {
        throw new TokenEndpointError(
            `Token endpoint returned HTTP ${response.status} (${response.statusText}). Verify the ` +
                `connectionString value is the Token Endpoint URL from Copilot Studio > Channels, and ` +
                `that the agent is published.`,
            response.status
        );
    }

    let body: DirectLineTokenResponse;
    try {
        body = (await response.json()) as DirectLineTokenResponse;
    } catch {
        throw new TokenEndpointError("Token endpoint did not return valid JSON.");
    }

    if (!body || typeof body.token !== "string" || body.token.length === 0) {
        throw new TokenEndpointError(
            "Token endpoint response did not include a 'token' field. Verify the connectionString " +
                "value is a Copilot Studio Direct Line token endpoint, not a Direct Line secret or bot URL."
        );
    }

    return body;
}
