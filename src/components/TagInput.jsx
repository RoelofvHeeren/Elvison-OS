import React, { useState } from 'react'
import { X } from 'lucide-react'

const TagInput = ({ value, onChange, suggestions }) => {
    const [input, setInput] = useState('')
    const tags = Array.isArray(value) ? value : []

    const addTag = (tag) => {
        if (tag && !tags.includes(tag)) {
            onChange([...tags, tag])
        }
        setInput('')
    }

    const removeTag = (tag) => {
        onChange(tags.filter(t => t !== tag))
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 p-3 bg-white/5 border border-white/20 rounded-lg min-h-[50px] shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
                {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 bg-teal-500/20 text-teal-300 px-3 py-1 rounded-full text-sm border border-teal-500/30">
                        {tag} <button onClick={() => removeTag(tag)}><X className="w-3 h-3 hover:text-white" /></button>
                    </span>
                ))}
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag(input))}
                    className="bg-transparent outline-none flex-1 min-w-[120px] text-white placeholder-gray-500"
                    placeholder="Type & Enter..."
                />
            </div>
            {/* Suggestions */}
            <div className="flex flex-wrap gap-2">
                {suggestions.filter(s => !tags.includes(s)).slice(0, 8).map(s => (
                    <button
                        key={s}
                        onClick={() => addTag(s)}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition-colors backdrop-blur-sm"
                    >
                        + {s}
                    </button>
                ))}
            </div>
        </div>
    )
}

export default TagInput
