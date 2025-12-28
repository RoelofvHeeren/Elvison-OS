/**
 * Retries a function with exponential backoff.
 * @param {Function} fn - The async function to retry.
 * @param {number} retries - Max number of retries.
 * @param {number} delay - Initial delay in ms.
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(fn, retries = 3, delay = 1000) {
    try {
        return await fn();
    } catch (err) {
        if (retries === 0) throw err;
        console.warn(`Retrying... attempts left: ${retries}. Error: ${err.message}`);
        await new Promise(res => setTimeout(res, delay));
        return retryWithBackoff(fn, retries - 1, delay * 2);
    }
}
