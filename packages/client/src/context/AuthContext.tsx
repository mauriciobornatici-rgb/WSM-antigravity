import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/services/api";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorHandling";
import {
    AUTH_STORAGE_KEY,
    USER_STORAGE_KEY,
    clearSessionStorage,
    getStoredToken,
    isTokenExpired,
} from "@/lib/authSession";
import type { LoginCredentials, LoginResponse } from "@/types/api";
import type { User } from "@/types";

export type UserRole = "admin" | "manager" | "cashier" | "warehouse";

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (credentials: LoginCredentials) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function parseStoredUser(value: string | null): User | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<User>;
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.id !== "string") return null;
        if (typeof parsed.name !== "string") return null;
        if (typeof parsed.email !== "string") return null;
        if (
            parsed.role !== "admin" &&
            parsed.role !== "manager" &&
            parsed.role !== "cashier" &&
            parsed.role !== "warehouse"
        ) {
            return null;
        }
        if (parsed.status !== "active" && parsed.status !== "inactive") return null;
        return parsed as User;
    } catch {
        return null;
    }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const storedUser = parseStoredUser(localStorage.getItem(USER_STORAGE_KEY));
        const token = getStoredToken();

        if (
            storedUser &&
            storedUser.status === "active" &&
            token &&
            !isTokenExpired(token, 30_000)
        ) {
            setUser(storedUser);
        } else {
            if (storedUser && token && isTokenExpired(token, 30_000)) {
                toast.info("Tu sesion expiro. Vuelve a iniciar sesion.");
            } else if (storedUser && storedUser.status !== "active") {
                toast.error("Usuario inactivo. Contacta a un administrador.");
            }
            clearSessionStorage();
        }

        setIsLoading(false);
    }, []);

    useEffect(() => {
        const syncSessionFromStorage = (event: StorageEvent) => {
            if (
                event.key !== null &&
                event.key !== USER_STORAGE_KEY &&
                event.key !== AUTH_STORAGE_KEY
            ) {
                return;
            }

            const storedUser = parseStoredUser(localStorage.getItem(USER_STORAGE_KEY));
            const token = getStoredToken();

            if (storedUser && token && !isTokenExpired(token, 30_000)) {
                setUser(storedUser);
                return;
            }

            setUser(null);
        };

        window.addEventListener("storage", syncSessionFromStorage);
        return () => window.removeEventListener("storage", syncSessionFromStorage);
    }, []);

    const login = async (credentials: LoginCredentials) => {
        try {
            const data: LoginResponse = await api.login(credentials);
            const userObj = data?.user ?? null;
            const token = data?.token ?? null;

            if (!userObj) {
                throw new Error("Invalid login response structure");
            }
            if (!token) {
                throw new Error("El servidor no devolvio token de sesion");
            }
            if (userObj.status !== "active") {
                clearSessionStorage();
                throw new Error("Usuario inactivo. Contacta a un administrador.");
            }

            setUser(userObj);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userObj));
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token }));

            toast.success(`Bienvenido, ${userObj.name}`);
        } catch (error) {
            toast.error(getErrorMessage(error, "Error al iniciar sesion"));
            throw error;
        }
    };

    const logout = () => {
        setUser(null);
        clearSessionStorage();
        toast.info("Sesion cerrada");
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
