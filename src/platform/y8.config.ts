// Y8 Developer Portal credentials for Dig Deep or Die! (SDK Initialization tab
// on developer.y8.com). Empty until the game is registered there: the Y8
// adapter then runs without the SDK, exactly like the local build.
export const Y8_APP_ID = '';
export const Y8_GAME_ID = '';

/** leaderboard tables by mode, named exactly as on the portal */
export const Y8_TABLES: Partial<Record<string, string>> = {};

/** achievements: our id -> the title and key the portal shows */
export const Y8_ACHIEVEMENTS: Partial<Record<string, { title: string; key: string }>> = {};
