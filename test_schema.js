import { z } from "zod";

const CompanyFinderSchema = z.object({
    results: z.array(z.object({
        companyName: z.string(),
        domain: z.string().optional(),
        primaryDomain: z.string().optional(),
        description: z.string().optional()
    })).refine(items => items.every(i => i.domain || i.primaryDomain), {
        message: "Each result must have a domain or primaryDomain"
    })
});

const data = {
    results: [
        {
            "companyName": "GWL Realty Advisors",
            "primaryDomain": "gwlrealtyadvisors.com",
            "description": "A real estate..."
        },
        {
            "companyName": "First National Financial LP",
            "primaryDomain": "firstnational.ca",
            "description": "Canada's largest..."
        }
    ]
};

try {
    const parsed = CompanyFinderSchema.parse(data);
    console.log("Validation PASSED ✓");
    console.log(JSON.stringify(parsed, null, 2));
} catch (e) {
    console.error("Validation FAILED ✗");
    console.error(JSON.stringify(e.format(), null, 2));
}
