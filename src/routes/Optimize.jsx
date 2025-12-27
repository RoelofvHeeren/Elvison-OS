import React, { useState, useEffect } from 'react';
import { useIcp } from '../context/IcpContext';
import axios from 'axios';
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, MessageSquare, Zap, CheckCircle, RotateCw } from 'lucide-react';

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

        // MOCK DATA FOR UI DEV
        setRuns([{ id: 'run_123', started_at: new Date().toISOString(), status: 'COMPLETED' }]);
        setSelectedRunId('run_123');
        setRunData([
            {
                id: 'comp_1', name: 'Acme Corp', website: 'acme.com',
                contacts: [
                    {
                        id: 'cont_1', name: 'John Doe', title: 'CEO', email: 'john@acme.com',
                        messages: [
                            { id: 'msg_1', subject: 'Partnership Opportunity', body: 'Hi John, saw you are leading Acme...' }
                        ]
                    },
                    {
                        id: 'cont_2', name: 'Jane Smith', title: 'HR Manager', email: 'jane@acme.com',
                        messages: [
                            { id: 'msg_2', subject: 'Hiring Solutions', body: 'Jane, regarding your hiring needs...' }
                        ]
                    }
                ]
            },
            {
                id: 'comp_2', name: 'TechStart', website: 'techstart.io',
                contacts: [
                    {
                        id: 'cont_3', name: 'Bob Dev', title: 'CTO', email: 'bob@techstart.io',
                        messages: [
                            { id: 'msg_3', subject: 'Tech Stack Integration', body: 'Bob, love what you built at TechStart...' }
                        ]
                    }
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
                entity_identifier: id,
                entity_type: data.entityType,
                grade: data.grade,
                notes: data.notes
            }));

            // TODO: Connect to backend
            // await axios.post(`/api/runs/${selectedRunId}/feedback`, { icpId: selectedIcp.id, feedbacks });
            // await axios.post(`/api/icps/${selectedIcp.id}/optimize`);

            // Simulate delay
            await new Promise(r => setTimeout(r, 1000));

            alert('Optimization Feedback Submitted!');
            setFeedback({});
        } catch (e) {
            console.error(e);
            alert('Failed to submit feedback');
        } finally {
            setIsOptimizing(false);
        }
    };

    if (!selectedIcp) return (
        <div className="flex items-center justify-center h-full p-8 text-gray-400">
            <div className="text-center">
                <p className="text-xl mb-2">No Strategy Selected</p>
                <p className="text-sm opacity-60">Please select a Strategy (ICP) from your Profile to optimize.</p>
            </div>
        </div>
    );

    return (
        <div className="flex h-full gap-6 p-6 lg:p-8 max-w-[1600px] mx-auto animate-fade-in">
            {/* Run Sidebar */}
            <div className="w-64 glass-panel p-4 flex flex-col gap-4 h-fit">
                <h2 className="text-xs uppercase tracking-wider font-bold text-primary px-2">Run History</h2>
                <div className="space-y-1">
                    {runs.map(run => (
                        <button
                            key={run.id}
                            onClick={() => setSelectedRunId(run.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${selectedRunId === run.id
                                    ? 'bg-primary/20 text-accent border border-primary/30'
                                    : 'text-muted hover:bg-white/5 hover:text-white'
                                }`}
                        >
                            <div className="font-bold">Run {run.id.slice(0, 6)}</div>
                            <div className="text-[10px] opacity-70">{new Date(run.started_at).toLocaleDateString()}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto space-y-6">
                <div className="glass-panel p-6 flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-5 h-5 text-accent" />
                            <h1 className="font-serif text-2xl font-bold text-white">Optimize Strategy</h1>
                        </div>
                        <p className="text-sm text-muted">Review generated messages to train your AI agent.</p>
                    </div>

                    <button
                        onClick={submitOptimization}
                        disabled={isOptimizing || Object.keys(feedback).length === 0}
                        className="flex items-center gap-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-all duration-200 hover:-translate-y-[1px] hover:bg-primaryDark disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isOptimizing ? <RotateCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        Apply Feedback
                    </button>
                </div>

                <div className="space-y-4">
                    {runData.map(company => (
                        <div key={company.id} className="glass-panel overflow-hidden">
                            {/* Company Header */}
                            <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
                                <div>
                                    <h3 className="text-lg font-bold text-white">{company.name}</h3>
                                    <a href={`https://${company.website}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{company.website}</a>
                                </div>
                                <FeedbackControl
                                    type="company"
                                    id={company.id}
                                    feedback={feedback[company.id]}
                                    onGrade={(g) => handleFeedback('company', company.id, g)}
                                />
                            </div>

                            {/* Contacts */}
                            <div className="p-6 space-y-6">
                                {company.contacts.map(contact => (
                                    <div key={contact.id} className="space-y-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                                                    {contact.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-white">{contact.name}</div>
                                                    <div className="text-sm text-primary/80">{contact.title}</div>
                                                </div>
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

                                        {/* Messages Section */}
                                        <div className="pl-12 space-y-3">
                                            {contact.messages?.map(msg => (
                                                <div key={msg.id} className="rounded-xl border border-white/10 bg-black/20 p-4 relative group">
                                                    <div className="mb-2 flex items-center justify-between">
                                                        <span className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-2">
                                                            <MessageSquare className="w-3 h-3" /> Outreach Message
                                                        </span>
                                                        <FeedbackControl
                                                            type="message"
                                                            id={msg.id}
                                                            feedback={feedback[msg.id]}
                                                            onGrade={(g) => handleFeedback('message', msg.id, g)}
                                                            showNotes
                                                            onNote={(n) => handleNote('message', msg.id, n)}
                                                        />
                                                    </div>
                                                    <div className="text-sm font-semibold text-white mb-1">{msg.subject}</div>
                                                    <div className="text-sm text-gray-300 whitespace-pre-wrap">{msg.body}</div>
                                                </div>
                                            ))}
                                        </div>
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
        <div className="flex items-center gap-3">
            {showNotes && (grade === 'negative' || grade === 'positive') && (
                <input
                    type="text"
                    placeholder="Rational (optional)..."
                    className="bg-transparent border-b border-white/20 px-2 py-1 text-xs text-white placeholder:text-gray-600 focus:border-primary outline-none min-w-[150px] transition-all animate-in fade-in slide-in-from-right-2"
                    onChange={(e) => onNote(e.target.value)}
                />
            )}
            <div className="flex items-center gap-1 bg-black/40 rounded-lg p-1 border border-white/10">
                <button
                    onClick={() => onGrade('positive')}
                    className={`p-1.5 rounded transition-colors ${grade === 'positive' ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-emerald-400'
                        }`}
                    title="Good Match"
                >
                    <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-3 bg-white/10"></div>
                <button
                    onClick={() => onGrade('negative')}
                    className={`p-1.5 rounded transition-colors ${grade === 'negative' ? 'bg-rose-500/20 text-rose-400' : 'text-gray-500 hover:text-rose-400'
                        }`}
                    title="Bad Match"
                >
                    <ThumbsDown className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    )
}

export default Optimize;
