import { useState } from 'react'
import { Plus, Trash2, GripVertical, Type, Star } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const COLUMN_TYPES = [
    { id: 'text', label: 'Text', icon: Type },
    { id: 'number', label: 'Number', icon: (props) => <span {...props} className="font-mono font-bold">#</span> },
    { id: 'date', label: 'Date', icon: (props) => <span {...props} className="font-mono">📅</span> },
    { id: 'select', label: 'Select', icon: (props) => <span {...props} className="font-mono">☰</span> },
]

const VisualColumnEditor = ({ columns, onChange }) => {
    // columns = [{ id, name, type, required }]

    const addColumn = () => {
        onChange([
            ...columns,
            { id: crypto.randomUUID(), name: '', type: 'text', required: false }
        ])
    }

    const updateColumn = (id, field, value) => {
        onChange(columns.map(c => c.id === id ? { ...c, [field]: value } : c))
    }

    const removeColumn = (id) => {
        onChange(columns.filter(c => c.id !== id))
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-medium text-lg">CRM Data Structure</h3>
                <button
                    onClick={addColumn}
                    className="text-teal-400 text-sm hover:text-teal-300 flex items-center gap-1 transition-colors"
                >
                    <Plus className="w-4 h-4" /> Add Field
                </button>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                <AnimatePresence>
                    {columns.map((col, idx) => (
                        <motion.div
                            key={col.id}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0 }}
                            className="group flex items-center gap-3 bg-black/40 border border-white/10 p-3 rounded-lg hover:border-teal-500/30 transition-all"
                        >
                            <GripVertical className="w-5 h-5 text-gray-600 cursor-move" />

                            <input
                                type="text"
                                placeholder="Field Name (e.g. Revenue)"
                                value={col.name}
                                onChange={(e) => updateColumn(col.id, 'name', e.target.value)}
                                className="flex-1 bg-transparent border-none text-white placeholder-gray-500 focus:ring-0 text-sm font-medium"
                                autoFocus={!col.name}
                            />

                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <select
                                        value={col.type}
                                        onChange={(e) => updateColumn(col.id, 'type', e.target.value)}
                                        className="appearance-none bg-black/50 border border-white/10 rounded-md py-1 px-2 pl-8 text-xs text-gray-300 focus:border-teal-500 outline-none cursor-pointer hover:bg-white/5"
                                    >
                                        {COLUMN_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                    </select>
                                    <Type className="w-3 h-3 text-gray-500 absolute left-2 top-1.5 pointer-events-none" />
                                </div>

                                <button
                                    onClick={() => updateColumn(col.id, 'required', !col.required)}
                                    className={`p-1.5 rounded-md transition-colors ${col.required ? 'text-yellow-400 bg-yellow-400/10' : 'text-gray-600 hover:text-gray-400'}`}
                                    title="Mark as Important/Required"
                                >
                                    <Star className={`w-4 h-4 ${col.required ? 'fill-yellow-400' : ''}`} />
                                </button>

                                <button
                                    onClick={() => removeColumn(col.id)}
                                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {columns.length === 0 && (
                    <div className="text-center py-8 border-2 border-dashed border-white/10 rounded-xl text-gray-500 text-sm">
                        No fields defined yet. <br />
                        <button onClick={addColumn} className="text-teal-500 hover:underline mt-2">Add your first data point</button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default VisualColumnEditor
