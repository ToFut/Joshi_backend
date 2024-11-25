import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import neo4j from 'neo4j-driver';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();


// Initialize Neo4j driver
const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

/**
 * Extract text from the file based on its type (TXT, DOCX, PDF).
 */
export async function extractTextFromFile(filePath, fileExt) {
    switch (fileExt.toLowerCase()) {
        case 'txt':
            return fs.promises.readFile(filePath, 'utf8');
        case 'docx':
            return await extractDocxText(filePath);
        case 'pdf':
            return await extractPdfText(filePath);
        default:
            throw new Error('Unsupported file type');
    }
}

// Extract DOCX text
export async function extractDocxText(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
}

// Extract PDF text
async function extractPdfText(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
}


/**
 * Process the contract by extracting content, analyzing it using Gemini, and saving the insights to Neo4j.
 */
export async function processContract(filePath, fileName, fileExt) {
    try {
        console.log(`Processing contract: ${fileName}`);

        const fileContent = await extractTextFromFile(filePath, fileExt);
        console.log(`Extracted content from ${fileName}. Length: ${fileContent.length} characters`);

        const analysisData = await analyzeContractWithGemini(fileContent, "Party A");
        console.log(`Contract analysis complete for ${fileName}`);

        await saveContractToNeo4j(fileName, analysisData);
        console.log(`Contract ${fileName} saved successfully to Neo4j.`);

        return analysisData;
    } catch (error) {
        console.error(`Error processing contract ${fileName}:`, error.message);
        throw error;
    }
}

/**
 * Fetch business insights from Neo4j (Business Snapshot).
 */
export async function getBusinessSnapshot() {
    const session = driver.session();
    try {
        const result = await session.run(`
            MATCH (c:Contract)-[:HAS_CHAPTER]->(ch:Chapter)
            OPTIONAL MATCH (c)-[:HAS_INSIGHT]->(i:Insight)
            OPTIONAL MATCH (c)-[:INVOLVES]->(p:Party)
            OPTIONAL MATCH (c)-[:HAS_DEADLINE]->(d:Deadline)
            RETURN c.fileName AS fileName, 
                   collect(i.description) AS insights, 
                   collect(DISTINCT p.name) AS involvedParties, 
                   collect(DISTINCT d {title: d.title, dueDate: d.deadline, status: d.status}) AS deadlines
        `);

        const businessSnapshot = result.records.map(record => ({
            fileName: record.get('fileName'),
            insights: record.get('insights') || [],
            involvedParties: record.get('involvedParties') || [],
            deadlines: record.get('deadlines') || []
        }));

        return {
            success: true,
            data: businessSnapshot,
        };
    } catch (error) {
        console.error('Error fetching business snapshot:', error.message);
        return {
            success: false,
            message: 'Error fetching business snapshot.',
            error: error.message,
        };
    } finally {
        await session.close();
    }
}
