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

    useEffect(() => {
        fetchIcps();
    }, []);

    return (
        <IcpContext.Provider value={{ icps, selectedIcp, selectIcp, fetchIcps, isLoading }}>
            {children}
        </IcpContext.Provider>
    );
};
