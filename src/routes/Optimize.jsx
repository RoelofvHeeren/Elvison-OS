import React, { useState, useEffect } from 'react';
import { useIcp } from '../context/IcpContext';
import axios from 'axios';
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, MessageSquare, Zap, CheckCircle } from 'lucide-react';

const Optimize = () => {
    const { selectedIcp } = useIcp();
    const [runs, setRuns] = useState([]);
    const [selectedRunId, setSelectedRunId] = useState(null);
    const [runData, setRunData] = useState([]); // Hierarchical data
    const [feedback, setFeedback] = useState({}); // { id: { grade, notes } }
    const [isOptimizing, setIsOptimizing] = useState(false);

    // Load Runs for ICP
    useEffect(() => {
        if (!selectedIcp) return;
        // Mocking fetching runs for now, or use real endpoint if exists
        // TODO: Implement GET /api/icps/:id/runs
        const loadRuns = async () => {
            // Placeholder: Fetch all runs and filter client-side if endpoint not ready
            // Or assumes /api/runs returns all user runs
            try {
                // const { data } = await axios.get('/api/runs');
                // const icpRuns = data.filter(r => r.icp_id === selectedIcp.id);
                // setRuns(icpRuns);
            } catch (e) { console.error(e) }
        };
        // loadRuns();

        // MOCK DATA FOR UI DEV
        setRuns([{ id: 'run_123', started_at: new Date().toISOString(), status: 'COMPLETED' }]);
        setSelectedRunId('run_123');
        setRunData([
            {
                id: 'comp_1', name: 'Acme Corp', website: 'acme.com',
                contacts: [
                    { id: 'cont_1', name: 'John Doe', title: 'CEO', email: 'john@acme.com' },
                    { id: 'cont_2', name: 'Jane Smith', title: 'HR Manager', email: 'jane@acme.com' }
                ]
            },
            {
                id: 'comp_2', name: 'TechStart', website: 'techstart.io',
                contacts: [
                    { id: 'cont_3', name: 'Bob Dev', title: 'CTO', email: 'bob@techstart.io' }
                ]
            }
        ]);

    }, [selectedIcp]);

    const handleFeedback = (entityType, id, grade) => {
        setFeedback(prev => ({
            ...prev,
            [id]: { ...prev[id], grade, entityType }
        }));
    };

    const handleNote = (entityType, id, note) => {
        setFeedback(prev => ({
            ...prev,
            [id]: { ...prev[id], notes: note, entityType }
        }));
    };

    const submitOptimization = async () => {
        setIsOptimizing(true);
        try {
            const feedbacks = Object.entries(feedback).map(([id, data]) => ({
                entity_identifier: id, // In real app, might need more specific ID mapping
                entity_type: data.entityType,
                grade: data.grade,
                notes: data.notes
            }));

            await axios.post(`/api/runs/${selectedRunId}/feedback`, {
                icpId: selectedIcp.id,
                feedbacks
            });

            // Trigger Optimization Agent
            await axios.post(`/api/icps/${selectedIcp.id}/optimize`);

            alert('Optimization Feedback Submitted!');
            setFeedback({});
        } catch (e) {
            console.error(e);
            alert('Failed to submit feedback');
        } finally {
            setIsOptimizing(false);
        }
    };

    if (!selectedIcp) return <div className="p-8 text-gray-400">Please select a Strategy (ICP) from your Profile first.</div>;

    return (
        <div className="flex h-full bg-gray-900 text-gray-100">
            {/* Run Sidebar */}
            <div className="w-64 border-r border-gray-800 p-4">
                <h2 className="text-xl font-serif font-bold text-teal-400 mb-4">Run History</h2>
                <div className="space-y-2">
                    {runs.map(run => (
                        <button
                            key={run.id}
                            onClick={() => setSelectedRunId(run.id)}
                            className={`w-full text-left p-3 rounded-lg text-sm ${selectedRunId === run.id ? 'bg-teal-900/40 text-teal-300 border border-teal-500/30' : 'hover:bg-gray-800'}`}
                        >
                            <div className="font-bold">Run {run.id.slice(0, 6)}</div>
                            <div className="text-xs text-gray-500">{new Date(run.started_at).toLocaleDateString()}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-8 overflow-y-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3">
                            <Zap className="text-yellow-400" /> Optimize Strategy
                        </h1>
                        <p className="text-gray-400 mt-2">Grade results to teach the AI what you like.</p>
                    </div>

                    <button
                        onClick={submitOptimization}
                        disabled={isOptimizing || Object.keys(feedback).length === 0}
                        className="bg-teal-500 hover:bg-teal-400 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isOptimizing ? <RotateCw className="animate-spin" /> : <CheckCircle />}
                        Apply Feedback
                    </button>
                </div>

                <div className="space-y-8">
                    {runData.map(company => (
                        <div key={company.id} className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
                            {/* Company Header */}
                            <div className="p-4 bg-gray-800 flex justify-between items-center">
                                <div>
                                    <h3 className="text-lg font-bold text-white">{company.name}</h3>
                                    <a href={`https://${company.website}`} target="_blank" className="text-xs text-teal-400 hover:underline">{company.website}</a>
                                </div>
                                <FeedbackControl
                                    type="company"
                                    id={company.id}
                                    feedback={feedback[company.id]}
                                    onGrade={(g) => handleFeedback('company', company.id, g)}
                                />
                            </div>

                            {/* Contacts */}
                            <div className="p-4 space-y-4">
                                {company.contacts.map(contact => (
                                    <div key={contact.id} className="flex items-start justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/50">
                                        <div>
                                            <div className="font-medium text-white">{contact.name}</div>
                                            <div className="text-sm text-teal-300">{contact.title}</div>
                                            <div className="text-xs text-gray-500">{contact.email}</div>
                                        </div>
                                        <FeedbackControl
                                            type="contact"
                                            id={contact.id}
                                            feedback={feedback[contact.id]}
                                            onGrade={(g) => handleFeedback('contact', contact.id, g)}
                                            showNotes
                                            onNote={(n) => handleNote('contact', contact.id, n)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const FeedbackControl = ({ type, id, feedback, onGrade, showNotes, onNote }) => {
    const grade = feedback?.grade;
    return (
        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1 border border-gray-700">
                <button
                    onClick={() => onGrade('positive')}
                    className={`p-1.5 rounded hover:bg-green-900/50 transition-colors ${grade === 'positive' ? 'text-green-400 bg-green-900/30' : 'text-gray-500'}`}
                >
                    <ThumbsUp className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onGrade('negative')}
                    className={`p-1.5 rounded hover:bg-red-900/50 transition-colors ${grade === 'negative' ? 'text-red-400 bg-red-900/30' : 'text-gray-500'}`}
                >
                    <ThumbsDown className="w-4 h-4" />
                </button>
            </div>
            {showNotes && (grade === 'negative' || grade === 'positive') && (
                <input
                    type="text"
                    placeholder="Why? (e.g. 'bad title')"
                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs w-48 focus:border-teal-500 outline-none"
                    onChange={(e) => onNote(e.target.value)}
                />
            )}
        </div>
    )
}

function RotateCw(props) {
    return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
}

export default Optimize;
