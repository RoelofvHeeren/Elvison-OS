import {
    LayoutDashboard, ListChecks, Plug, Sparkles, Table, Wand2, BookOpen, Bot, PlayCircle,
    Terminal, CheckCircle, AlertCircle, Loader2, Send, FileText, Globe
} from 'lucide-react';

const icons = {
    LayoutDashboard, ListChecks, Plug, Sparkles, Table, Wand2, BookOpen, Bot, PlayCircle,
    Terminal, CheckCircle, AlertCircle, Loader2, Send, FileText, Globe
};

console.log('Checking icons...');
const missing = [];
for (const [name, icon] of Object.entries(icons)) {
    if (!icon) {
        missing.push(name);
    } else {
        // console.log(`✓ ${name}`);
    }
}

if (missing.length > 0) {
    console.error('MISSING ICONS:', missing.join(', '));
    process.exit(1);
} else {
    console.log('All icons found!');
}
