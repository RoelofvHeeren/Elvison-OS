import React, { createContext, useContext, useState, useEffect } from 'react';
import * as api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check if user is already authenticated on mount
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            const currentUser = await api.getCurrentUser();
            setUser(currentUser);
        } catch (error) {
            // Not authenticated
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function signup(email, password, name) {
        const response = await api.signup(email, password, name);
        setUser(response.user);
        return response;
    }

    async function login(email, password) {
        const response = await api.login(email, password);
        setUser(response.user);
        return response;
    }

    async function logout() {
        await api.logout();
        setUser(null);
    }

    const value = {
        user,
        loading,
        signup,
        login,
        logout,
        isAuthenticated: !!user
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
