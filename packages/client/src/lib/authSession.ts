const AUTH_STORAGE_KEY = "sports_erp_auth";
const USER_STORAGE_KEY = "sports_erp_user";

// Remove credentials persisted by versions prior to the HttpOnly-cookie migration.
export function clearSessionStorage(): void {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(USER_STORAGE_KEY);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

export { AUTH_STORAGE_KEY, USER_STORAGE_KEY };
