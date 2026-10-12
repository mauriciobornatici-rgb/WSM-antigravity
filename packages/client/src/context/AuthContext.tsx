/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/services/api";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorHandling";
import { clearSessionStorage } from "@/lib/authSession";
import type { LoginCredentials, LoginResponse } from "@/types/api";
import type { User } from "@/types";

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (credentials: LoginCredentials) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;
        clearSessionStorage();
        api.getSession()
            .then(({ user: sessionUser }) => {
                if (active) setUser(sessionUser);
            })
            .catch(() => {
                if (active) setUser(null);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    const login = async (credentials: LoginCredentials) => {
        try {
            const data: LoginResponse = await api.login(credentials);
            const userObj = data?.user ?? null;

            if (!userObj) {
                throw new Error("Respuesta de inicio de sesion invalida");
            }
            if (userObj.status !== "active") {
                await api.logout().catch(() => undefined);
                throw new Error("Usuario inactivo. Contacta a un administrador.");
            }

            setUser(userObj);
            clearSessionStorage();
            toast.success(`Bienvenido, ${userObj.name}`);
        } catch (error) {
            toast.error(getErrorMessage(error, "Error al iniciar sesion"));
            throw error;
        }
    };

    const logout = async () => {
        try {
            await api.logout();
        } finally {
            setUser(null);
            clearSessionStorage();
            toast.info("Sesion cerrada");
        }
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
        throw new Error("useAuth debe usarse dentro de AuthProvider");
    }
    return context;
}
