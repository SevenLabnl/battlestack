export type Platform = 'darwin' | 'win32' | 'linux' | 'other'

/** Runtime host detection. Distinguishes WSL2 from native Linux. */
export type RuntimeHost = 'macos' | 'windows' | 'wsl' | 'linux' | 'other'
