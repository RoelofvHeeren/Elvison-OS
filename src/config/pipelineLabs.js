/**
 * Strict Pipeline Labs (Pine Labs) Integration Configuration
 * 
 * This file acts as the Single Source of Truth for allowed titles and enum values
 * for the Pipeline Labs scraper.
 * 
 * CRITICAL: Do NOT add new titles here unless they are explicitly approved.
 * Validation errors will occur if values match the scraper's internal enum but are rejected here,
 * OR if values here do not match the scraper's enum.
 */

export const ALLOWED_PERSON_TITLES = [
    "Executive Director",
    "Director Of Operations",
    "Director Of Sales",
    "Director Of Business Development",
    "Founder",
    "Co-Founder",
    "General Manager",
    "Head Of Operations",
    "Head Of Business Development",
    "Founding Partner",
    "Co-Owner",
    "Business Owner",
    "CEO/President/Owner",
    "Executive Vice President"
];

export const ALLOWED_SENIORITY = [
    "Director",
    "VP",
    "C-Suite",
    "Owner",
    "Head",
    "Founder",
    "Partner"
];

// Titles that are allowed but handled separately in the payload under 'personTitleExtraIncludes' 
// or mapped differently if needed. For now, strictly following the provided input.
export const ALLOWED_EXTRA_TITLES = [
    "Chief Investment Officer",
    "Principal",
    "Managing Director",
    "Director of Investments",
    "Director of Developments",
    "Partner",
    "Managing Partner",
    "CEO",
    "President",
    "Vice President",
    "CIO",
    "COO"
];

export const SENIORITY_EXCLUDES = [
    "Entry",
    "Intern"
];

// Helper to check if a title is valid
export const isTitleAllowed = (title) => {
    return ALLOWED_PERSON_TITLES.includes(title) || ALLOWED_EXTRA_TITLES.includes(title);
};
