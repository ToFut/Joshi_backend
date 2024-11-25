import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getBusinessSnapshot, processContract, extractTextFromFile } from './contract_analyzer.js';
import { analyzeContractWithGemini, getGeminiSummary, getLatestSummaryFromNeo4j, dynamicQueryWithJoshi, fetchContractData, saveSummaryToNeo4j, marketTrends} from './joshi.js';
import { Storage } from '@google-cloud/storage';
import {fetchContractSummaries, fetchRelevantNews} from './news.js'
import fs from 'fs';
import axios from 'axios';
import cors from 'cors';  // Import CORS

import neo4j from 'neo4j-driver';

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());  // Enable CORS for all routes

const upload = multer({ dest: 'uploads/' });

const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);


console.log('Joshi AI system initialized...');

app.post('/fetch-files', async (req, res) => {
    const { accessToken } = req.body;

    if (!accessToken) {
        return res.status(400).json({ error: 'Access token is required.' });
    }

    try {
        const drive = google.drive({
            version: 'v3',
            auth: accessToken,
        });

        const response = await drive.files.list({
            pageSize: 100,
            fields: 'files(id, name, mimeType)',
        });

        const files = response.data.files;
        console.log('Files fetched:', files);

        // You can send files to analysis here if not done already
        // (Optional to trigger on fetch, backend could defer and batch analysis)
        res.status(200).json({ success: true, files, message: 'Files sent for processing.' });
    } catch (error) {
        console.error('Error fetching files from Google Drive:', error.message);
        res.status(500).json({ error: 'Failed to fetch files from Google Drive.' });
    }
});

app.get('/memory', async (req, res) => {
    const session = driver.session();
    console.log("memory");

    try {
        const result = await session.run(`
            MATCH (m:Contracts)
            RETURN m
        `);
        
        const memoryData = result.records.map(record => record.get('m').properties);
        res.status(200).json({ success: true, data: memoryData });
    } catch (error) {
        console.error('Error fetching memory data:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch memory data.' });
    } finally {
        await session.close();
    }
});


// Endpoint to upload contracts and process them
app.post('/uploads', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    const fileExt = req.file?.originalname.split('.').pop();
    const fileName = req.file?.originalname || 'Unknown File';

    console.log("proccessing with", fileName);
    if (!filePath || !['txt', 'docx', 'pdf', 'doc'].includes(fileExt)) {
        return res.status(400).json({ error: 'Invalid file type or no file uploaded.' });
    }

    try {
        console.log(`Contract ${fileName} received, processing will start in background.`);
        processContractInBackground(filePath, fileName, fileExt);
        res.json({ message: 'Contract is being processed. You can check the status later.' });
    } catch (error) {
        console.error('Error receiving contract:', error.message);
        res.status(500).json({ error: 'Error receiving contract.' });
    }
});

async function processContractInBackground(filePath, fileName, fileExt) {
    try {
        console.log(`[INFO] Starting background processing for contract: ${fileName}`);

        // Read the file and encode to Base64
        const fileBuffer = fs.readFileSync(filePath);
        const base64Content = fileBuffer.toString('base64');

        // Send file to Python API for processing
        console.log(`[INFO] Sending file to Python API: ${fileName}`);
        const response = await axios.post('http://localhost:8000/process-file', {
            fileName,
            content: base64Content,
        });

        // Save insights to Neo4j
        console.log(`[INFO] Saving insights to Neo4j for ${fileName}`);
        await saveToNeo4j(insights);
        console.log(`[SUCCESS] Contract ${fileName} and insights saved to Neo4j successfully.`);
    } catch (error) {
        console.error(`[ERROR] Error processing contract ${fileName}:`, error.message);
    } finally {
        // Delete temporary file
        fs.unlinkSync(filePath);
        console.log(`[INFO] Temporary file deleted: ${filePath}`);
    }
}


// Fetch contracts and include contractID
app.get('/contracts', async (req, res) => {
    const session = driver.session();
    try {
        const result = await session.run(
            `MATCH (c:Contract)
             RETURN c.contractID AS contractID, c.fileName AS fileName`
        );

        const contracts = result.records.map(record => ({
            contractID: record.get('contractID'),
            fileName: record.get('fileName')
        }));

        console.log('Contracts retrieved:', contracts);
        res.status(200).json(contracts);
    } catch (error) {
        console.error('Error fetching contracts:', error.message);
        res.status(500).json({ success: false, message: 'Error fetching contracts.', error: error.message });
    } finally {
        await session.close();
    }
});

app.post('/save-contract', async (req, res) => {
    const { contractID, fileContent, fileName, analysisData } = req.body;

    try {
        await saveContractToNeo4j(contractID, fileContent, fileName, analysisData);
        res.status(200).json({ message: `Contract ${fileName} saved successfully!` });
    } catch (error) {
        console.error('Error saving contract:', error.message);
        res.status(500).json({ error: 'Failed to save contract to Neo4j.' });
    }
});


// Fetch detailed contract analysis by contractID
app.get('/contractAnalysis', async (req, res) => {
    const contractID = decodeURIComponent(req.query.contractID);
    let session = null;

    try {
        console.log(`Starting analysis request for contractID: ${contractID}`);

        session = driver.session();
        console.log("Database session started");

        const result = await session.run(
            `MATCH (c:Contract {contractID: $contractID})
             OPTIONAL MATCH (c)-[:HAS_BUSINESS_OVERVIEW]->(businessOverview)
             OPTIONAL MATCH (c)-[:HAS_KEY_METRICS]->(keyMetrics)
             OPTIONAL MATCH (c)-[:HAS_RISKS]->(risks)
             OPTIONAL MATCH (c)-[:HAS_MUST_DO_TASKS]->(mustDoTasks)
             OPTIONAL MATCH (c)-[:HAS_OPPORTUNITIES]->(opportunities)
             OPTIONAL MATCH (c)-[:HAS_SUGGESTIONS]->(suggestions)
             OPTIONAL MATCH (c)-[:HAS_CRITICAL_DATES]->(criticalDates)
             OPTIONAL MATCH (c)-[:HAS_FINANCIAL_IMPLICATIONS]->(financialImplications)
             OPTIONAL MATCH (c)-[:HAS_LEGAL_CONSIDERATIONS]->(legalConsiderations)
             OPTIONAL MATCH (c)-[:HAS_STAKEHOLDER_ANALYSIS]->(stakeholderAnalysis)
             RETURN c.contractID AS contractID,
                    c.fileName AS fileName,
                    businessOverview { .* } AS businessOverview,
                    keyMetrics { .* } AS keyMetrics,
                    risks { .* } AS risks,
                    mustDoTasks { .* } AS mustDoTasks,
                    opportunities { .* } AS opportunities,
                    suggestions { .* } AS suggestions,
                    criticalDates { .* } AS criticalDates,
                    financialImplications { .* } AS financialImplications,
                    legalConsiderations { .* } AS legalConsiderations,
                    stakeholderAnalysis { .* } AS stakeholderAnalysis`,
            { contractID }
        );        

        console.log(`Query executed for contractID: ${contractID}`);

        if (result.records.length === 0) {
            console.warn(`No contract found for contractID: ${contractID}`);
            return res.status(404).json({ success: false, error: 'Contract not found' });
        }

        const record = result.records[0];
        const contractAnalysisOverview = {
            contractID: record.get('contractID'),
            fileName: record.get('fileName'),
            businessOverview: record.get('businessOverview') || {},
            keyMetrics: record.get('keyMetrics') || {},
            risks: record.get('risks') || {},
            mustDoTasks: record.get('mustDoTasks') || {},
            opportunities: record.get('opportunities') || {},
            suggestions: record.get('suggestions') || {},
            criticalDates: record.get('criticalDates') || {},
            financialImplications: record.get('financialImplications') || {},
            legalConsiderations: record.get('legalConsiderations') || {},
            stakeholderAnalysis: record.get('stakeholderAnalysis') || {}
        };

        console.log(`Contract analysis retrieved for contractID:`, contractAnalysisOverview);
        res.json({ success: true, data: contractAnalysisOverview });
    } catch (error) {
        console.error('Error fetching contract analysis:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (session) {
            console.log("Closing the database session");
            await session.close();
        }
    }
});
// Endpoint for analyzing the question and interacting with Neo4j and Gemini

// Express endpoint for processing the request
app.post('/ask-joshi', async (req, res) => {
    const question = req.body.question;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {        
        // Submit the question to Gemini for a comprehensive answer
        const geminiResponse = await dynamicQueryWithJoshi(question);

        let responseText = geminiResponse.text || geminiResponse.response?.text();

        // Clean up potential formatting issues (like backticks)
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        // Assuming geminiResponse has a text property directly
        res.status(200).json({ answer: responseText }); // Return the text response
    } catch (error) {
        console.error('Error processing the request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// API to get an overview of all contracts
app.get('/contractsOverview', async (req, res) => {
    let session = null;

    try {
        session = driver.session();

        // Query to gather insights about all contracts
        const result = await session.run(`
            MATCH (c:Contract)
            OPTIONAL MATCH (c)-[:HAS_BUSINESS_OVERVIEW]->(businessOverview)
            OPTIONAL MATCH (c)-[:HAS_KEY_METRICS]->(keyMetrics)
            OPTIONAL MATCH (c)-[:HAS_RISKS]->(risks)
            OPTIONAL MATCH (c)-[:HAS_FINANCIAL_IMPLICATIONS]->(financialImplications)
            RETURN 
                c.contractID AS contractID,
                COUNT(c) AS totalContracts,
                COLLECT(businessOverview) AS businessOverviews,
                COLLECT(keyMetrics) AS keyMetricsList,
                COLLECT(risks) AS risksList,
                COLLECT(financialImplications) AS financialImplicationsList
        `);

        if (result.records.length === 0) {
            return res.status(404).json({ success: false, message: 'No contracts found' });
        }

        const overview = result.records.map(record => {
            return {
                contractID: record.get('contractID'),
                businessOverview: record.get('businessOverviews').map(b => b.properties),
                keyMetrics: record.get('keyMetricsList').map(k => k.properties),
                risks: record.get('risksList').map(r => r.properties),
                financialImplications: record.get('financialImplicationsList').map(f => f.properties)
            };
        });

        
        res.json({ success: true, data: overview });
    } catch (error) {
        console.error('Error fetching contracts overview:', error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (session) {
            await session.close();
        }
    }
});

const storage = new Storage(); // Ensure this line is included to create an instance of Storage

// Endpoint to list files in a Google Cloud Storage bucket
app.get('/files', async (req, res) => {
    const bucketName = process.env.GCLOUD_STORAGE_BUCKET; // Your bucket name from the environment variable

    try {
        const [files] = await storage.bucket(bucketName).getFiles();
        const fileNames = files.map(file => file.name);

        res.status(200).json({
            success: true,
            files: fileNames,
        });
    } catch (error) {
        console.error('Error retrieving files:', error);
        res.status(500).json({ success: false, error: 'Error retrieving files.' });
    }
});
// Route to fetch and summarize contract data

// Function to save the summary to Neo4j
app.get('/fullOverview', async (req, res) => {
    try {
        // Fetch contract data
        const contractData = await fetchContractData();
        console.log('Contract Data:', contractData); // Log contract data

        // Send data to Gemini for structured summarization
        const geminiSummary = await getGeminiSummary(contractData);

        // Save summary to Neo4j
        const savedSummary = await saveSummaryToNeo4j(geminiSummary);

        // Log the saved summary before sending to frontend
        console.log("Summary sent to frontend:", savedSummary);

        // Prepare the response
        const response = {
            averageContractDuration: savedSummary.averageContractDuration,
            totalRevenue: savedSummary.totalRevenue,
            totalContracts: savedSummary.totalContracts,
            totalCost: savedSummary.totalCost
        };

        console.log("Response JSON:", response); // Log the response JSON

        res.status(200).json(response);
    } catch (error) {
        console.error('Error generating dashboard overview:', error);
        res.status(500).json({ error: 'Failed to generate dashboard overview' });
    }
});

// API to update contract insights
app.get('/news', async (req, res) => {

    try {        
        // Submit the question to Gemini for a comprehensive answer
        const geminiResponse = await marketTrends();

        let responseText = geminiResponse.text || geminiResponse.response?.text();

        // Clean up potential formatting issues (like backticks)
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        console.log(responseText);
        // Assuming geminiResponse has a text property directly
        res.status(200).json({ answer: responseText }); // Return the text response
    } catch (error) {
        console.error('Error processing the request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/process-file', (req, res) => {
    console.log('Received request:', req.body);
    // ... existing logic ...
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Joshi server is running on port ${PORT}`));
