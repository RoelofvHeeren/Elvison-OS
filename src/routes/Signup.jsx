import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Signup = () => {
    const navigate = useNavigate();
    const { signup } = useAuth();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validation
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }

        setLoading(true);

        try {
            await signup(email, password, name);
            // Redirect to onboarding for new users
            navigate('/onboarding');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create account. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const passwordStrength = () => {
        if (!password) return null;
        if (password.length < 8) return { label: 'Weak', color: 'red' };
        if (password.length < 12) return { label: 'Good', color: 'yellow' };
        return { label: 'Strong', color: 'green' };
    };

    const strength = passwordStrength();

    return (
        <div className="min-h-screen w-full bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center p-6">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute top-1/4 -left-48 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 -right-48 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
            </div>

            {/* Signup Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full max-w-md"
            >
                {/* Logo */}
                <div className="mb-8 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-2xl bg-black/40 border border-teal-500/30 shadow-[0_0_30px_rgba(20,184,166,0.2)] backdrop-blur-md">
                        <img src="/logo-columns.png" alt="Elvison" className="w-10 h-10 object-contain" />
                    </div>
                    <h1 className="text-4xl font-serif font-bold text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">
                        Create Account
                    </h1>
                    <p className="text-gray-400 mt-2">Join Elvison OS and start automating</p>
                </div>

                {/* Form Card */}
                <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Error Message */}
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3"
                            >
                                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                <p className="text-red-300 text-sm">{error}</p>
                            </motion.div>
                        )}

                        {/* Name Field */}
                        <div>
                            <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider">
                                Full Name
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-transparent border border-white/30 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none shadow-md"
                                placeholder="Your name"
                                disabled={loading}
                            />
                        </div>

                        {/* Email Field */}
                        <div>
                            <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full bg-transparent border border-white/30 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none shadow-md"
                                placeholder="you@example.com"
                                disabled={loading}
                            />
                        </div>

                        {/* Password Field */}
                        <div>
                            <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider">
                                Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                minLength={8}
                                className="w-full bg-transparent border border-white/30 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none shadow-md"
                                placeholder="At least 8 characters"
                                disabled={loading}
                            />
                            {strength && (
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full transition-all ${strength.color === 'red' ? 'bg-red-500 w-1/3' :
                                                    strength.color === 'yellow' ? 'bg-yellow-500 w-2/3' :
                                                        'bg-green-500 w-full'
                                                }`}
                                        />
                                    </div>
                                    <span className={`text-xs ${strength.color === 'red' ? 'text-red-400' :
                                            strength.color === 'yellow' ? 'text-yellow-400' :
                                                'text-green-400'
                                        }`}>
                                        {strength.label}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Confirm Password Field */}
                        <div>
                            <label className="block text-sm font-bold text-teal-400 mb-2 uppercase tracking-wider">
                                Confirm Password
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                className="w-full bg-transparent border border-white/30 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition-all outline-none shadow-md"
                                placeholder="Repeat password"
                                disabled={loading}
                            />
                            {confirmPassword && (
                                <div className="mt-2">
                                    {password === confirmPassword ? (
                                        <div className="flex items-center gap-2 text-green-400 text-sm">
                                            <CheckCircle2 className="w-4 h-4" />
                                            Passwords match
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-red-400 text-sm">
                                            <AlertCircle className="w-4 h-4" />
                                            Passwords don't match
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading || password !== confirmPassword}
                            className="w-full px-8 py-3 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg shadow-[0_0_20px_rgba(20,184,166,0.3)] transition-all hover:scale-105 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                <>
                                    <UserPlus className="w-5 h-5" />
                                    Create Account
                                </>
                            )}
                        </button>
                    </form>

                    {/* Sign In Link */}
                    <div className="mt-6 pt-6 border-t border-white/10 text-center">
                        <p className="text-gray-400 text-sm">
                            Already have an account?{' '}
                            <Link
                                to="/login"
                                className="text-teal-400 hover:text-teal-300 font-semibold transition-colors"
                            >
                                Sign in
                            </Link>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Signup;
