import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import natural from 'natural';

// Load environment variables
dotenv.config();

// Initialize Neo4j driver
const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export async function analyzeContractWithGemini(fileContent, fileName, party) {
    try {

        const prompt = `
        Analyze the following contract and provide detailed insights in **valid, properly formatted JSON**. Focus on the perspective of "${party}" and their obligations in the contract. Ensure that the JSON structure is simple, with no deeply nested elements. The JSON must be syntactically correct and well-formatted. Avoid trailing commas, extra quotation marks, and incorrect array formatting, less explantion more key:value mertics for spesific insight. Include the following sections:

        1. \`Business_Overview\`: Provide a concise summary of the business arrangement described in the contract, get key:value insgihts not explnations for example contract contrcat_type: exlusive distribution over.., industry... party A: company A; Party B: Company B...
        
        2. \`Key_Metrics\`: Identify and explain important numerical or qualitative metrics mentioned in the contract. Return as key-value pairs, where the key is the name of the metric, and the value is its description, for exmaple sales_volume: 1000000 units, credit_term: 30 days, .
        
        3. \`Risks\`: Analyze potential risks for ${party}, both explicit in the contract and implicit based on the business context. Return risks as a flat key-value list, using simple keys like 'External_Risk_A', 'Internal_Risk_A', etc.
        
        4. \`Must_Do_Tasks\`: Provide a detailed to-do list for ${party}, organized by department (e.g., Legal, Finance, Operations). Ensure that each task is actionable and specific, and return each task as a key-value pair in the form 'Department_Task_X': 'Task description'.
        
        5. \`Opportunities\`: Identify potential opportunities for ${party} arising from this contract. Return each opportunity as a simple key-value pair where the key is 'Opportunity_X', and the value is its description.
        
        6. \`Suggestions\`: Provide actionable recommendations for ${party} to optimize their position in this contract. Return each recommendation as a key-value pair in the form 'Suggestion_X': 'Recommendation description'.
        
        7. \`Critical_Dates\`: List any important dates or deadlines mentioned in the contract, along with their significance. Each date should be returned as a key-value pair where the key is 'Critical_Date_X', and the value is the date and its significance.
        
        8. \`Financial_Implications\`: Summarize the financial aspects of the contract, including costs, revenues, and potential financial risks or benefits. Return each as a key-value pair.
        
        9. \`Legal_Considerations\`: Highlight key legal points that ${party} should be aware of. Use a flat structure where each legal point is returned as 'Legal_Consideration_X': 'Description'.
        
        10. \`Stakeholder_Analysis\`: Identify key stakeholders and describe their roles or interests as well . Each stakeholder should be returned 'Stakeholder_X': 'Stakeholder role or interest'.
        
        11. \`Contract_Summary\`: create a summary and main keywords of the contract that combine all main insights for future questions about the contract.

        12. \`Competitors\`: list of direct and indirect competitors and its competitive position

        Contract content:
        "${fileContent}"
        **Important:**
returns a well-defined structure that aligns with our Neo4j schema. Instead of returning deeply nested structures, the output should be a flat structure with relevant keys and values.


        Return the analysis as valid, well-formed JSON. **Ensure that there are no syntax errors**, such as unclosed brackets, missing commas, or incorrectly formatted arrays. The JSON should be ready to parse and use directly.
        `;
        
               
        // Call the model's generateContent method with the correct structure
        const result = await model.generateContent(prompt);

        // Extract and clean up the response text
        let responseText = result.text || result.response?.text();

        // Clean up potential formatting issues (like backticks)
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

        // Parse the cleaned text into JSON
        const analysisData = JSON.parse(responseText);

        console.log(analysisData);

        // Generate a unique ID for the contract
        const contractID = `contract-${Date.now()}`;

        // Save the contract data in Neo4j
        await saveContractToNeo4j(contractID, fileContent, fileName, analysisData);

        return analysisData;

    } catch (error) {
        console.error('Error calling Gemini API:', error.message);
        throw error;
    }
}
// Helper function to sanitize keys by replacing invalid characters for Neo4j
function sanitizeKey(key) {
    console.log(key);
    return key.replace(/[^\w]/g, '_'); // Replace non-alphanumeric characters with underscores
}

function flattenObject(obj, prefix = '', result = {}) {
    for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}_${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value) && key !== "Contract_Summary") {
            // Only flatten nested objects, but skip Contract_Summary
            flattenObject(value, newKey, result);
        } else {
            result[newKey] = value; // Store full sentence or array as-is
        }
    }
    return result;
}



// Update to the function to save the contract data in Neo4j
// Save the contract data into Neo4j
export async function saveContractToNeo4j(contractID, fileContent, fileName, analysisData) {
    const session = driver.session();
    console.log(`Saving contract: ${fileName} with ID: ${contractID}`);

    const tx = session.beginTransaction();  // Start a transaction
    try {
        // Create the main contract node
        await tx.run(`
            MERGE (c:Contract {contractID: $contractID})
            ON CREATE SET c.fileName = $fileName, c.fileContent = $fileContent
        `, { contractID, fileName, fileContent });
        
        // Process each section of the contract data
        for (const [section, data] of Object.entries(analysisData)) {
            console.log("data", data, "section", section)
            const sectionLabel = sanitizeKey(section); // Sanitize section name
            const flattenedData = flattenObject(data);  // Ensure all properties are in key-value format

            // Create a single node for each section with the appropriate properties
            await tx.run(`
                MERGE (c:Contract)
                MERGE (n:${sectionLabel} {contractID: $contractID})
                SET n += $properties
                MERGE (c)-[:HAS_${sectionLabel.toUpperCase()}]->(n)
            `, { contractID, properties: flattenedData });
        }
        console.log(`Contract ${fileName} and its insights have been saved to Neo4j with ID: ${contractID}`);

        // Commit the transaction
        await tx.commit();
    } catch (error) {
        await tx.rollback();  // Rollback in case of an error
        console.error('Error saving contract to Neo4j:', error.message);
        throw error;
    } finally {
        await session.close();
    }
}

// Function to analyze the question with Gemini and return an array of keywords
async function analyzeQuestionWithGemini(question) {
    const prompt = `Extract 15 relevant direct or indirect 1 word, source of nature, or the most basic keywords and return only the potential keywords without explanation or more characters for the following question: "${question}"`; 
    try {
        const response = await model.generateContent(prompt);
        
        console.log("Gemini Response:", response);
        
        // Validate the response from Gemini
        if (!response || !response.response || typeof response.response.text !== 'function') {
            throw new Error('Gemini response is undefined or missing text.');
        }

        const extractedText = response.response.text();
        console.log("Extracted Keywords:", extractedText);

        // Clean keywords
        const keywords = extractedText.split(/[,\n]/)
            .map(keyword => keyword.trim().toLowerCase())
            .filter(keyword => keyword && keyword.length > 1) // Remove empty and single-character keywords
            .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates
            .slice(0, 15); // Limit to 15 keywords as per the original request

        console.log("Extracted keywords:", keywords);
        return keywords;
    } catch (error) {
        console.error('Error analyzing question with Gemini:', error.message);
        throw error;
    }
}


// Main function to process the question
export async function dynamicQueryWithJoshi(question) {
    const session = driver.session();
    console.log(`Processing question with Joshi: ${question}`);

    try {
        const keywords = await analyzeQuestionWithGemini(question);
        console.log("Keywords: ", keywords);

        let relevantData = [];
        try {
            relevantData = await searchSpecificNodes(session, keywords);
        } catch (error) {
            console.error('Neo4j query error:', error);
            throw error;
        }

        console.log("Relevant nodes Data: ", relevantData);

        // Fetch contract summaries and merge with relevant data
        const contractSummaries = await fetchContractSummaries(session);
        relevantData = relevantData.concat(contractSummaries);

        console.log("Relevant Data: ", relevantData);
        const data = formatDataForGemini(relevantData);

        console.log("Background Info: ", data);

        const dataToGemini = `Make it accurate and direct, answer the question: ${question} Background info: ${data}, combine info from public avalible and make the answer friendly which help user get action items insights.`;


        console.log(dataToGemini);
        const geminiResponse = await submitToGemini(dataToGemini);
        return geminiResponse;

    } catch (error) {
        console.error('Error querying Joshi:', error.message);
        throw error;
    } finally {
        await session.close();
    }
}

export async function marketTrends() {
    const session = driver.session();
    console.log(`market trends`);

    try {
        // Fetch contract summaries and use them as a basis for relevant data
        const contractSummaries = await fetchContractSummaries(session);
        let relevantData = contractSummaries;

        console.log("Contract Summaries: ", relevantData);

        const dataToGemini = `
            Analyze the following contract summaries to identify high-impact market trends and strategic insights. Use high-quality, reputable news sources. For each news item:
            1. Provide a clear summary and link to the original source.
            2. Contextualize the news in relation to the contract's business objectives and competitive landscape.
            3. Generate predictive insights, identifying how this news might shape industry direction, impact market dynamics, or introduce risks and opportunities relevant to the contract's goals.
            4. If necessary, cross-reference multiple news sources to deliver a comprehensive perspective, connecting related events or developments for a fuller understanding.
            5. Provide strategic recommendations tailored to the contract context, including actionable steps and scenarios for adapting to the news.
            6. Where applicable, assess potential longer-term effects on market positioning, competitive advantage, regulatory considerations, or pricing strategies.
            
            Examples:
            - *News Source*: "Forbes reports that a competitor launched a new product featuring A, B, and C at a competitive price."
                - *Impact Insight*: This product release suggests increased market pressure and highlights evolving customer expectations for features A and B.
                - *Strategic Recommendations*: Evaluate enhancing feature B or introducing an exclusive feature to retain market differentiation. Consider a pricing analysis to ensure competitiveness.
            - *News Source*: "NY Times announces a new regulatory policy affecting products/services related to [user product]."
                - *Regulatory Insight*: This regulation could introduce compliance challenges or costs. Predict potential shifts in market dynamics and suggest adjustments to product development or operational strategies.

            Contract Background Info: ${JSON.stringify(relevantData)}
        `;

        console.log(dataToGemini);
        const geminiResponse = await submitToGemini(dataToGemini);
        return geminiResponse;

    } catch (error) {
        console.error('Error querying Joshi:', error.message);
        throw error;
    } finally {
        await session.close();
    }
}
// Function to search for specific nodes in Neo4j based on keywords
async function searchSpecificNodes(session, keywords) {
    const results = []; // Initialize an array to store results
    console.log("Searching for keywords:", keywords);

    try {
        // Loop through each keyword and perform a separate query for both nodes and relationships
        for (let keyword of keywords) {  // Use 'let' instead of 'const'
            console.log("Searching for keyword:", keyword);
            const cleanedKeyword = keyword.replace(/[^\w\s]/gi, '').trim(); // Remove non-alphanumeric characters

            // Search for nodes directly related to the keyword
            const query = `
                MATCH (n)
                WHERE n.description CONTAINS $cleanedKeyword OR n.name CONTAINS $cleanedKeyword
                RETURN n
            `;
            const result = await session.run(query, { cleanedKeyword });
            results.push(...result.records); // Aggregate results

            const relationshipKeyword = cleanedKeyword.toUpperCase();  // Use a different variable for the uppercased keyword

            // Search for nodes with relationships based on the keyword
            const relationshipQuery = `
                MATCH (n)-[r:HAS_${relationshipKeyword}]->(m)
                RETURN n, r, m
            `;
            const relationshipResult = await session.run(relationshipQuery, { keyword: relationshipKeyword });
            results.push(...relationshipResult.records); // Aggregate results
        }

        return results; // Always return an array
    } catch (error) {
        console.error('Neo4j query error:', error);
        throw error;
    }
}

// Function to fetch contract summaries from Neo4j// Function to fetch contract summaries from Neo4j
// Updated query to fetch contract summaries with a specific relationship
async function fetchContractSummaries(session) {
    const query = `
        MATCH (c)-[:HAS_CONTRACT_SUMMARY]->(n:Contract_Summary)
        RETURN c.contractID AS contractID, n.contract_summary AS summaryText
    `;

    console.log("Fetching contract summaries with specific relationships...");
    try {
        const result = await session.run(query);
        
        // Aggregate contract summaries and IDs
        const summaries = result.records.map(record => ({
            contractID: record.get('contractID') || "No contract ID available",
            summaryText: record.get('summaryText') || "No summary available"
        }));
        
        console.log("Contract summaries fetched:", summaries);
        return summaries; // Return array of contract summaries with IDs
    } catch (error) {
        console.error('Neo4j fetch contract summaries error:', error);
        return []; // Return an empty array on error
    }
}


// Function to format relevant data as a string for Gemini
function formatDataForGemini(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return "No relevant data found.";
    }

    return records.map(record => {
        const summaryText = record.summaryText || "No summary available"; // Access the specific properties
        const contractID = record.contractID || "No contract ID available"; // Access the contract ID
        return `Contract ID: ${contractID}, Summary: "${summaryText}"`; // Format for Gemini
    }).join('\n\n'); // Join multiple entries with a double newline for clarity
}

// Function to submit the combined data to Gemini for processing
async function submitToGemini(data) {
    try {
        const response = await model.generateContent(data); // Ensure this is the correct call for your model
        console.log("Gemini response:", response);
        return response; // Return the response from Gemini
    } catch (error) {
        console.error('Error submitting data to Gemini:', error.message);
        throw error;
    }
}

// Function to query Neo4j for all relevant contract data
// Function to fetch contract data from Neo4j
export async function fetchContractData() {
    const session = driver.session();
    const toConcatenatedString = (obj) => {
        return Object.entries(obj)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(', ');
    };

    const DEFAULT_CONTRACT_ID = "No Contract Info";

    try {
        const result = await session.run(`
            MATCH (f:Financial_Implications), (d:Critical_Dates)
            RETURN f AS financialImplication, d AS criticalDates
        `);
        
        const implicationsMap = new Map();  // Use a Map to ensure unique contract IDs

        result.records.forEach(record => {
            const financialImplicationNode = record.get('financialImplication');
            const criticalDatesNode = record.get('criticalDates');

            const contractID = financialImplicationNode?.properties.contractID || DEFAULT_CONTRACT_ID;

            // Create a new object for the current contract
            const implication = {
                financialImplication: financialImplicationNode 
                    ? toConcatenatedString(financialImplicationNode.properties) 
                    : '',
                criticalDates: criticalDatesNode 
                    ? toConcatenatedString(criticalDatesNode.properties) 
                    : '',
                contractID: contractID
            };

            // Check if the contractID already exists in the map
            if (!implicationsMap.has(contractID)) {
                implicationsMap.set(contractID, implication);
            }
        });

        // Convert the Map back to an array for the final result
        const implications = Array.from(implicationsMap.values());

        console.log('Final implications:', JSON.stringify(implications, null, 2));
        
        return implications;
    } catch (error) {
        console.error('Error fetching contract data:', error);
        throw error;
    } finally {
        await session.close();
    }
}

export async function saveSummaryToNeo4j(summary) {
    const session = driver.session(); // Create a new session
    try {
        const criticalDatesString = Array.isArray(summary['Critical Dates']) ? 
            summary['Critical Dates'].join(', ') : '';

        await session.run(`
            MERGE (s:Summary {type: "dashboard"})
            SET s.totalContracts = $totalContracts,
                s.totalRevenue = $totalRevenue,
                s.totalCost = $totalCost,
                s.criticalDates = $criticalDates,
                s.averageContractDuration = $averageContractDuration,
                s.lastUpdated = timestamp()
        `, {
            totalContracts: summary['Total Contracts'],
            totalRevenue: summary['Total Revenue'],
            totalCost: summary['Total Cost'],
            criticalDates: criticalDatesString,
            averageContractDuration: summary['Average Contract Duration']
        });
        
        // Fetch and return the saved summary to the frontend
        const savedSummaryResult = await session.run(`MATCH (s:Summary {type: "dashboard"}) RETURN s`);
        const savedSummary = savedSummaryResult.records[0].get('s').properties; // Assuming there's only one dashboard summary

        console.log("send to frontend", savedSummary);
        return {
            lastUpdated: savedSummary.lastUpdated,
            criticalDates: savedSummary.criticalDates,
            averageContractDuration: savedSummary.averageContractDuration,
            totalRevenue: savedSummary.totalRevenue,
            totalContracts: savedSummary.totalContracts,
            totalCost: savedSummary.totalCost
        }; // Return a structured object matching the frontend expectations
    } catch (error) {
        console.error('Error saving summary to Neo4j:', error);
        throw new Error('Failed to save summary to Neo4j.');
    } finally {
        await session.close(); // Ensure the session is closed
    }
}
// Function to generate a summary using the contract data
export async function getGeminiSummary(contractData) {
    console.log("contract Data", contractData);

    if (!Array.isArray(contractData) || contractData.length === 0) {
        throw new Error("Invalid contract data provided. Expected an array of contract objects.");
    }

    const prompt = JSON.stringify(contractData) + `
        Summarize the following contract data with structured output for above only without explanation:
        - Total Contracts: Integer
        - Total Revenue: Sum of all 'revenue' values, as Number
        - Total Cost: Sum of all 'cost' values, as Number
        - Critical Dates: List of unique dates from 'criticalDates', as Date list
        - Average Contract Duration: Average of 'contractDuration' in years, as Number
    `;

    const structuredSummary = await model.generateContent(prompt);
    let responseText = structuredSummary.text || structuredSummary.response?.text();

    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    let geminiSummary;
    try {
        geminiSummary = JSON.parse(responseText);
    } catch (parseError) {
        console.error('Error parsing summary response:', parseError);
        throw new Error('Failed to parse the summary response from Gemini.');
    }

    console.log("summary", geminiSummary);
    // Handle null values
    geminiSummary['Total Revenue'] = geminiSummary['Total Revenue'] !== null ? geminiSummary['Total Revenue'] : 0;
    geminiSummary['Total Cost'] = geminiSummary['Total Cost'] !== null ? geminiSummary['Total Cost'] : 0;
    geminiSummary['Average Contract Duration'] = geminiSummary['Average Contract Duration'] !== null ? geminiSummary['Average Contract Duration'] : 0;
    
    console.log("Parameters to save to Neo4j:", geminiSummary);
    
    return geminiSummary;
}

function hasSummaryChanged(existingSummary, newContractData) {
    // Assuming getGeminiSummary(newContractData) returns the new summary format
    const newSummary = getGeminiSummary(newContractData);

    // Check for changes in the total number of contracts
    if (existingSummary['Total Contracts'] !== newSummary['Total Contracts']) {
        return true;
    }

    // Check for changes in total revenue if not null
    if (existingSummary['Total Revenue'] !== newSummary['Total Revenue']) {
        return true;
    }

    // Check for changes in total cost if not null
    if (existingSummary['Total Cost'] !== newSummary['Total Cost']) {
        return true;
    }

    // Check for changes in critical dates
    if (existingSummary['Critical Dates'].length !== newSummary['Critical Dates'].length ||
        existingSummary['Critical Dates'].some((date, index) => date !== newSummary['Critical Dates'][index])) {
        return true;
    }

    // Check for changes in average contract duration if not null
    if (existingSummary['Average Contract Duration'] !== newSummary['Average Contract Duration']) {
        return true;
    }

    // If no changes are detected, return false
    return false;
}

// Function to get the latest summary from Neo4j
export async function getLatestSummaryFromNeo4j() {
    const session = driver.session();
    try {
        const result = await session.run(`MATCH (s:Summary {type: "dashboard"}) RETURN s LIMIT 1`);
        if (result.records.length === 0) {
            return null; // No summary found
        }
        const latestSummary = result.records[0].get('s').properties; // Assuming there's only one dashboard summary

        return {
            averageContractDuration: latestSummary.averageContractDuration,
            totalRevenue: latestSummary.totalRevenue,
            totalContracts: latestSummary.totalContracts,
            totalCost: latestSummary.totalCost
        };
    } catch (error) {
        console.error('Error fetching latest summary from Neo4j:', error);
        throw new Error('Failed to fetch latest summary from Neo4j.');
    } finally {
        await session.close(); // Ensure the session is closed
    }
}