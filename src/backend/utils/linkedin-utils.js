/**
 * Normalizes a LinkedIn URL to the standard format: https://www.linkedin.com/in/username
 * Handles country subdomains (e.g., ca.linkedin.com -> www.linkedin.com)
 * Ensures https protocol.
 * 
 * @param {string} url - The raw LinkedIn URL
 * @returns {string|null} - Normalized URL or null if invalid
 */
export function normalizeLinkedInUrl(url) {
    if (!url || typeof url !== 'string') return null;

    let cleanUrl = url.trim();

    // Basic validation: must contain linkedin.com
    if (!cleanUrl.toLowerCase().includes('linkedin.com')) {
        return cleanUrl; // Return as is if it's not a standard LinkedIn URL (could be SalesNav shortened, etc.), or null?
        // Let's be safe: if it looks like a LinkedIn URL, normalize it. If not, keeping it might be safer than deleting data.
    }

    try {
        // Add protocol if missing to parse correctly
        if (!cleanUrl.startsWith('http')) {
            cleanUrl = 'https://' + cleanUrl;
        }

        const urlObj = new URL(cleanUrl);

        // Normalize hostname: force www.linkedin.com
        if (urlObj.hostname.endsWith('linkedin.com')) {
            urlObj.hostname = 'www.linkedin.com';
        }

        // Force HTTPS
        urlObj.protocol = 'https:';

        // Clean up pathname: remove trailing slash
        if (urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }

        // Return standardized URL
        // We usually want just the profile part, removing query params like ?miniProfileUrn=...
        // But some URLs might rely on query params? Usually public profile URLs don't.
        // Let's strip query params to be clean as Aimfox likely prefers clean URLs.
        urlObj.search = '';
        urlObj.hash = '';

        return urlObj.toString();

    } catch (e) {
        // If normalization fails, return original or null?
        console.warn(`Failed to normalize LinkedIn URL: ${url}`, e);
        return url; // Return original as fallback
    }
}
