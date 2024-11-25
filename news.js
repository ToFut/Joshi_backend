// Helper function to fetch HAS_CONTRACT_SUMMARY from Neo4j
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";


// Load environment variables
dotenv.config();

// Initialize Neo4j driver
const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export async function fetchContractSummaries() {
    const result = await session.run('MATCH (c:Contract) RETURN c.HAS_CONTRACT_SUMMARY AS summary');
    console.log(result);
    return result.records.map(record => record.get('summary'));
}

// Helper function to fetch relevant news based on contract summaries
export async function fetchRelevantNews(summaries) {
    const newsArticles = [];
    for (const summary of summaries) {
        const prompt = `
            Please fetch recent news articles related to the following business context:
            Summary: "${summary}"
            For each news article, provide:
            1. URL
            2. One-sentence summary of the news
            3. How it affects or relates to our business
            4. Suggested actions we should consider taking.
        `;

        try {
            const articles = await model.generateContent(prompt);
            newsArticles.push(...articles);
        } catch (error) {
            console.error('Error fetching news:', error);
        }
    }

    console.log(newsArticles);
    return newsArticles;
}

// Helper function to store insights in Neo4j
export async function storeInsightsInNeo4j(insights) {
    const transaction = session.beginTransaction();
    for (const insight of insights) {
        await transaction.run(
            'MATCH (c:Contract) ' +
            'CREATE (c)-[:HAS_INSIGHT]->(i:Insight {url: $url, summary: $summary, impact: $impact, actions: $actions})',
            {
                contractId,
                url: insight.url,
                summary: insight.summary,
                impact: insight.impact,
                actions: insight.actions
            }
        );
    }
    await transaction.commit();
}

