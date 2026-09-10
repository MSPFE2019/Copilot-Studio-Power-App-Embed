declare module "botframework-webchat/component.js" {
    import type * as React from "react";
    import type { DirectLine } from "botframework-directlinejs";

    export interface WebChatStyleOptions {
        hideUploadButton?: boolean;
        botAvatarInitials?: string;
        accent?: string;
        primaryFont?: string;
        showTypingIndicatorInBubble?: boolean;
        sendBoxBackground?: string;
    }

    export interface ReactWebChatProps {
        directLine: DirectLine;
        styleOptions?: WebChatStyleOptions;
    }

    export const ReactWebChat: React.ComponentType<ReactWebChatProps>;
}
