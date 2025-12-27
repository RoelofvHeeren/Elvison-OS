import React, { useEffect } from 'react';
import { useIcp } from '../context/IcpContext';
import { useNavigate } from 'react-router-dom';
import { PlusCircle, Target, Settings, Play } from 'lucide-react';

const Profile = () => {
    const { icps, fetchIcps, selectIcp } = useIcp();
    const navigate = useNavigate();

    useEffect(() => {
        fetchIcps();
    }, []);

    const handleCreateNew = () => {
        navigate('/onboarding?mode=create_icp');
    };

    const handleSelect = (icp) => {
        selectIcp(icp);
        navigate('/runner');
    };

    return (
        <div className="p-6 lg:p-8 max-w-[1600px] mx-auto text-gray-100 animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-serif font-bold text-teal-400">My Strategies (ICPs)</h1>
                    <p className="text-gray-400 mt-2">Manage your Ideal Customer Profiles and optimization settings.</p>
                </div>
                <button
                    onClick={handleCreateNew}
                    disabled={icps.length >= 3}
                    className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <PlusCircle className="w-5 h-5" />
                    New ICP
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {icps.map(icp => (
                    <div key={icp.id} className="bg-white/5 border border-white/10 rounded-xl p-6 hover:border-teal-500/30 transition-colors flex flex-col">
                        <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-teal-500/10 rounded-full">
                                <Target className="w-6 h-6 text-teal-400" />
                            </div>
                            <button onClick={() => navigate(`/icp/${icp.id}/settings`)} className="text-gray-500 hover:text-white">
                                <Settings className="w-5 h-5" />
                            </button>
                        </div>

                        <h3 className="text-xl font-bold text-white mb-2">{icp.name}</h3>
                        <div className="text-sm text-gray-400 mb-4 flex-1">
                            {icp.config?.geography ? `Targeting: ${Array.isArray(icp.config.geography) ? icp.config.geography.join(', ') : icp.config.geography}` : 'Custom Strategy'}
                        </div>

                        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                            <span className="text-xs text-gray-500">Created: {new Date(icp.created_at).toLocaleDateString()}</span>
                            <button
                                onClick={() => handleSelect(icp)}
                                className="text-teal-400 text-sm font-bold hover:text-teal-300 flex items-center gap-1"
                            >
                                Select & Run <Play className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                ))}

                {icps.length === 0 && (
                    <div className="col-span-full text-center py-12 border border-dashed border-gray-700 rounded-xl">
                        <p className="text-gray-500 mb-4">No strategies defined yet.</p>
                        <button onClick={handleCreateNew} className="text-teal-400 font-bold hover:underline">Create your first ICP</button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Profile;
