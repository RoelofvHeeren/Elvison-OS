import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const IcpContext = createContext();

export const useIcp = () => useContext(IcpContext);

export const IcpProvider = ({ children }) => {
    const [icps, setIcps] = useState([]);
    const [selectedIcp, setSelectedIcp] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchIcps = async () => {
        setIsLoading(true);
        try {
            const { data } = await axios.get('/api/icps');
            setIcps(data.icps);

            // Auto-select logic
            const storedId = localStorage.getItem('selected_icp_id');
            if (storedId) {
                const found = data.icps.find(i => i.id === storedId);
                if (found) setSelectedIcp(found);
                else if (data.icps.length > 0) setSelectedIcp(data.icps[0]);
            } else if (data.icps.length > 0) {
                setSelectedIcp(data.icps[0]);
            }
        } catch (error) {
            console.error('Failed to fetch ICPs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const selectIcp = (icp) => {
        setSelectedIcp(icp);
        if (icp) localStorage.setItem('selected_icp_id', icp.id);
        else localStorage.removeItem('selected_icp_id');
    };

    const updateIcp = async (id, data) => {
        try {
            // Optimistic update
            const optimisticUpdate = { ...icps.find(i => i.id === id), ...data }
            setIcps(prev => prev.map(icp => icp.id === id ? optimisticUpdate : icp));

            const response = await axios.put(`/api/icps/${id}`, data);

            // Re-sync with server response if available, otherwise keep optimistic
            if (response.data && response.data.icp) {
                setIcps(prev => prev.map(icp => icp.id === id ? response.data.icp : icp));
                if (selectedIcp?.id === id) setSelectedIcp(response.data.icp);
                return response.data.icp;
            } else {
                // Fallback to optimistic
                console.warn("Server did not return updated ICP object, using optimistic state.");
                return optimisticUpdate;
            }
        } catch (error) {
            console.error('Failed to update ICP:', error);
            // Revert state if needed (not implemented for simplicity, but good practice)
            throw error;
        }
    };

    useEffect(() => {
        fetchIcps();
    }, []);

    return (
        <IcpContext.Provider value={{ icps, selectedIcp, selectIcp, fetchIcps, updateIcp, isLoading }}>
            {children}
        </IcpContext.Provider>
    );
};
