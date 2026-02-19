const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

// At least one lowercase, one uppercase, one number and one symbol.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

export const passwordPolicy = {
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    regex: STRONG_PASSWORD_REGEX
};

export function isStrongPassword(value) {
    if (typeof value !== 'string') return false;
    const candidate = value.trim();
    if (candidate.length < PASSWORD_MIN_LENGTH || candidate.length > PASSWORD_MAX_LENGTH) {
        return false;
    }
    return STRONG_PASSWORD_REGEX.test(candidate);
}

export function getPasswordPolicyMessage() {
    return `La contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres e incluir mayúscula, minúscula, número y símbolo.`;
}
