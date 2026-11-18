export const SHORT_LOGIN_SECONDS = 12 * 60 * 60;
export const REMEMBER_LOGIN_SECONDS = 30 * 24 * 60 * 60;
export function loginDuration(rememberDevice) { return rememberDevice === true ? REMEMBER_LOGIN_SECONDS : SHORT_LOGIN_SECONDS; }
