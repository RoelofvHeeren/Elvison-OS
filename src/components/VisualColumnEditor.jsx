import { useState } from 'react'
import { safeUUID } from '../utils/security'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { Plus, X, GripVertical, Type, Hash, Calendar, Link as LinkIcon, Mail, Phone, FileText, List, Star } from 'lucide-react'

const COLUMN_TYPES = [
    { id: 'text', label: 'Text', icon: Type },
    { id: 'long_text', label: 'Long Text', icon: FileText },
    { id: 'number', label: 'Number', icon: Hash },
    { id: 'date', label: 'Date', icon: Calendar },
    { id: 'link', label: 'Link', icon: LinkIcon },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'phone', label: 'Phone', icon: Phone },
    { id: 'status', label: 'Status', icon: List },
]

const VisualColumnEditor = ({ columns, onChange }) => {

    const onDragEnd = (result) => {
        if (!result.destination) return

        const items = Array.from(columns)
        const [reorderedItem] = items.splice(result.source.index, 1)
        items.splice(result.destination.index, 0, reorderedItem)

        onChange(items)
    }

    const addColumn = () => {
        onChange([
            ...columns,
            { id: safeUUID(), name: 'New Field', type: 'text', required: false }
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
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-white font-medium text-lg">CRM Structure Preview</h3>
                <button
                    onClick={addColumn}
                    className="bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 text-sm px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors border border-teal-500/30"
                >
                    <Plus className="w-4 h-4" /> Add Column
                </button>
            </div>

            {/* Horizontal Scroll Container mimicking a Sheet */}
            <div className="relative border border-white/20 rounded-xl bg-black/40 overflow-hidden shadow-inner">
                {/* Grid Pattern Background */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '20px 20px' }}
                />

                <div className="overflow-x-auto pb-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20">
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="columns" direction="horizontal">
                            {(provided) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="flex items-start min-w-max p-4 gap-0"
                                >
                                    {columns.map((col, index) => (
                                        <Draggable key={col.id} draggableId={col.id} index={index}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    className={`
                                                        w-64 border-r border-white/10 relative group transition-colors
                                                        ${snapshot.isDragging ? 'bg-teal-900/30 z-10 shadow-xl scale-105 rounded-lg border' : 'bg-transparent hover:bg-white/5'}
                                                        first:pl-0
                                                    `}
                                                    style={provided.draggableProps.style}
                                                >
                                                    {/* Header Cell Look */}
                                                    <div className="px-3 py-2 flex flex-col gap-2">
                                                        {/* Top Row: Handle + Delete */}
                                                        <div className="flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity mb-1">
                                                            <div {...provided.dragHandleProps} className="cursor-grab hover:text-teal-400 text-gray-600 p-1">
                                                                <GripVertical className="w-4 h-4" />
                                                            </div>
                                                            <button onClick={() => removeColumn(col.id)} className="text-gray-600 hover:text-rose-400 p-1">
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        </div>

                                                        {/* Input Name */}
                                                        <input
                                                            type="text"
                                                            value={col.name}
                                                            onChange={(e) => updateColumn(col.id, 'name', e.target.value)}
                                                            className="bg-transparent text-white font-bold text-sm border-b border-transparent focus:border-teal-500 hover:border-white/20 outline-none px-1 py-0.5 w-full uppercase tracking-tighter"
                                                        />

                                                        {/* Type & Required */}
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <div className="relative flex-1">
                                                                <select
                                                                    value={col.type}
                                                                    onChange={(e) => updateColumn(col.id, 'type', e.target.value)}
                                                                    className="w-full appearance-none bg-white/5 border border-white/10 rounded px-2 py-1 pl-7 text-xs text-gray-300 outline-none focus:border-teal-500 cursor-pointer"
                                                                >
                                                                    {COLUMN_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                                                </select>
                                                                {/* Icon for type */}
                                                                <div className="absolute left-2 top-1.5 pointer-events-none opacity-50">
                                                                    {(() => {
                                                                        const TypeIcon = COLUMN_TYPES.find(t => t.id === col.type)?.icon || Type
                                                                        return <TypeIcon className="w-3 h-3 text-teal-400" />
                                                                    })()}
                                                                </div>
                                                            </div>

                                                            <button
                                                                onClick={() => updateColumn(col.id, 'required', !col.required)}
                                                                className={`p-1 rounded hover:bg-white/10 transition-colors ${col.required ? 'text-yellow-400' : 'text-gray-700'}`}
                                                                title={col.required ? "Required Field" : "Optional Field"}
                                                            >
                                                                <Star className={`w-3.5 h-3.5 ${col.required ? 'fill-yellow-400' : ''}`} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}

                                    {/* Add Button at end of list */}
                                    <button
                                        onClick={addColumn}
                                        className="w-12 h-24 flex items-center justify-center border-l border-white/10 text-gray-600 hover:text-teal-400 hover:bg-white/5 transition-colors"
                                    >
                                        <Plus className="w-6 h-6" />
                                    </button>
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                </div>
            </div>
            <p className="text-xs text-gray-500 text-center">Drag headers to reorder. These columns will be created in your PostgreSQL database.</p>
        </div>
    )
}

export default VisualColumnEditor
