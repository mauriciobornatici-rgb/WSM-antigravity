export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// Keep aligned with backend password policy.
export const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

export const PASSWORD_POLICY_PATTERN = STRONG_PASSWORD_REGEX.source;

export const PASSWORD_POLICY_TEXT = `La contrasena debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres e incluir mayuscula, minuscula, numero y simbolo.`;

export function isStrongPassword(value: string): boolean {
    const candidate = value.trim();
    if (candidate.length < PASSWORD_MIN_LENGTH || candidate.length > PASSWORD_MAX_LENGTH) {
        return false;
    }
    return STRONG_PASSWORD_REGEX.test(candidate);
}
