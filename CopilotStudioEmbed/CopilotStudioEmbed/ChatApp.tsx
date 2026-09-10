import * as React from "react";
import { DirectLine } from "botframework-directlinejs";
import { ReactWebChat } from "botframework-webchat/component.js";
import { DirectLineTokenResponse, fetchDirectLineToken, TokenEndpointError } from "./directLineTokenClient";

export interface ChatAppProps {
    connectionString: string;
    botName?: string;
    accentColor?: string;
    showTypingIndicator?: boolean;
}

type LoadState =
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; directLine: DirectLine; sessionKey: number };

// Refresh proactively at 80% of the token's lifetime; Copilot Studio's default token
// lifetime is ~1 hour (3600s), so this defaults to a 48 minute refresh cadence if the
// endpoint does not report expires_in.
const DEFAULT_EXPIRES_IN_SECONDS = 3600;
const REFRESH_SAFETY_FACTOR = 0.8;
const MIN_REFRESH_MS = 15_000;

export const ChatApp: React.FC<ChatAppProps> = (props) => {
    const { connectionString, botName, accentColor, showTypingIndicator } = props;

    const [state, setState] = React.useState<LoadState>({ kind: "loading" });
    const sessionKeyRef = React.useRef<number>(0);
    const refreshTimerRef = React.useRef<number | undefined>(undefined);
    const disposedRef = React.useRef<boolean>(false);

    const clearRefreshTimer = React.useCallback(() => {
        if (refreshTimerRef.current !== undefined) {
            window.clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = undefined;
        }
    }, []);

    const connect = React.useCallback(
        async (isReconnect: boolean) => {
            if (!isReconnect) {
                setState({ kind: "loading" });
            }

            let tokenResponse: DirectLineTokenResponse;
            try {
                tokenResponse = await fetchDirectLineToken(connectionString);
            } catch (error) {
                if (disposedRef.current) {
                    return;
                }
                const message = error instanceof TokenEndpointError ? error.message : String(error);
                setState({ kind: "error", message });
                return;
            }

            if (disposedRef.current) {
                return;
            }

            const directLine = new DirectLine({
                token: tokenResponse.token,
                conversationId: tokenResponse.conversationId,
                streamUrl: tokenResponse.streamUrl
            });

            // Detect token expiry / connection failure and reconnect by minting a fresh
            // token from the same Copilot Studio token endpoint. Note: because Copilot
            // Studio's token endpoint issues a new conversationId on each call, this
            // starts a new conversation rather than truly resuming the old one - see the
            // "Known limitations" section of the README.
            const subscription = directLine.connectionStatus$.subscribe({
                next: (connectionStatus: number) => {
                    // ConnectionStatus.ExpiredToken === 999, ConnectionStatus.FailedToConnect === 3
                    if ((connectionStatus === 999 || connectionStatus === 3) && !disposedRef.current) {
                        subscription.unsubscribe();
                        void connect(true);
                    }
                }
            });

            sessionKeyRef.current += 1;
            setState({ kind: "ready", directLine, sessionKey: sessionKeyRef.current });

            clearRefreshTimer();
            const expiresInSeconds = tokenResponse.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS;
            const refreshInMs = Math.max(expiresInSeconds * 1000 * REFRESH_SAFETY_FACTOR, MIN_REFRESH_MS);
            refreshTimerRef.current = window.setTimeout(() => {
                if (!disposedRef.current) {
                    void connect(true);
                }
            }, refreshInMs);
        },
        [connectionString, clearRefreshTimer]
    );

    React.useEffect(() => {
        disposedRef.current = false;
        void connect(false);
        return () => {
            disposedRef.current = true;
            clearRefreshTimer();
        };
        // Intentionally scoped to connectionString only: `connect` is recreated whenever
        // connectionString changes (which is exactly what should retrigger this effect),
        // so it does not need to be listed as a dependency here.
    }, [connectionString]);

    const styleOptions = React.useMemo(
        () => ({
            hideUploadButton: true,
            botAvatarInitials: botName ? botName.substring(0, 2).toUpperCase() : undefined,
            accent: accentColor || undefined,
            primaryFont: "'Segoe UI', Tahoma, Arial, sans-serif",
            showTypingIndicatorInBubble: showTypingIndicator !== false,
            sendBoxBackground: "#FFFFFF"
        }),
        [botName, accentColor, showTypingIndicator]
    );

    if (state.kind === "loading") {
        return (
            <div className="mspfe-copilot-embed-status">
                <div className="mspfe-copilot-embed-spinner" />
                <div>Connecting to {botName || "Copilot Studio agent"}...</div>
            </div>
        );
    }

    if (state.kind === "error") {
        return (
            <div className="mspfe-copilot-embed-status">
                <div className="mspfe-copilot-embed-error">
                    <div className="mspfe-copilot-embed-error-title">Unable to connect to the agent</div>
                    {state.message}
                </div>
            </div>
        );
    }

    return (
        <div className="mspfe-copilot-embed-webchat">
            <ReactWebChat key={state.sessionKey} directLine={state.directLine} styleOptions={styleOptions} />
        </div>
    );
};
