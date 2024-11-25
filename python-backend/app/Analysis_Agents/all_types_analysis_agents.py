import os
import google.generativeai as genai
import spacy

GEMINI_API_KEY = 'AIzaSyCS5fipdlJOmmKPcPvP67X-xzn6ZrUx3FY'

# Load SpaCy NLP model
nlp = spacy.load("en_core_web_sm")

# Debugging logs
def debug_log(message, *args):
    print(f"DEBUG: {message} {' '.join(map(str, args))}")

# Gemini Client for AI-based insights
class GeminiClient:
    def __init__(self, api_key):
        try:
            debug_log("Initializing Gemini Client with API Key.")
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(model_name="gemini-1.5-flash")
            debug_log("Gemini Client initialized successfully.")
        except Exception as e:
            debug_log("Error during Gemini Client initialization:", e)
            self.model = None

    def call_gemini_api(self, prompt):
        try:
            debug_log("Sending prompt to Gemini API:", prompt[:100])
            response = self.model.generate_content(prompt)
            debug_log("Raw response from Gemini API:", response.text)
            return response.text
        except Exception as e:
            debug_log("Error calling Gemini API:", e)
            return {"error": str(e)}

# Analysis Function
def analyze_file(file_type, content):
    debug_log("Performing analysis on file type:", file_type)
    prompt = generate_prompt(file_type, content)
    gemini_client = GeminiClient(api_key=GEMINI_API_KEY)
    result = gemini_client.call_gemini_api(prompt)
    contextual_data = extract_contextual_entities(content)
    categorized_relationships = categorize_relationships(contextual_data["relationships"])
    return {
        "gemini_output": result,
        "entities": contextual_data["entities"],
        "relationships": categorized_relationships
    }

def extract_contextual_entities(content):
    doc = nlp(content)
    entities = [{"text": ent.text, "label": ent.label_} for ent in doc.ents]
    relationships = [
        {
            "subject": token.head.text if token.dep_ != "ROOT" else None,
            "action": token.text,
            "object": [child.text for child in token.children if child.dep_ in {"dobj", "pobj"}],
            "context": token.sent.text
        }
        for token in doc
        if token.dep_ in {"nsubj", "dobj", "pobj", "attr", "ROOT"}
    ]
    return {"entities": entities, "relationships": relationships}

def categorize_relationships(relationships):
    categorized = []
    for rel in relationships:
        if "obligated" in rel["context"].lower():
            rel_type = "obligation"
        elif "depends on" in rel["context"].lower():
            rel_type = "dependency"
        else:
            rel_type = "general"
        categorized.append({**rel, "type": rel_type})
    return categorized

def generate_prompt(file_type, file_content):
    """Generate a detailed prompt for the specific file type."""
    prompts = {
        "legal_contract": f""" in english
        Analyze the following legal contract and provide detailed insights in valid JSON:
        1. Obligations: Obligations for all parties.
        2. Risks: Explicit and implicit risks.
        3. Critical Dates.
        4. Termination Conditions.
        5. Confidentiality Clauses.
        6. Liability Clauses.
        7. Payment Terms.
        8. Indemnification Clauses.
        9. Dispute Resolution Mechanisms.
        10. Contract Duration.
        11. Non-Compete Clauses.
        12. Key Deliverables.
        13. Insurance Requirements.
        14. Regulatory Compliance.
        15. Governing Law.
        Contract Content: 
        {file_content}
        """,
        "financial_report": f"""
        Analyze this financial report and provide insights in valid JSON:
        1. Revenue Trends.
        2. Expense Breakdown.
        3. Net Income Trends.
        4. Liabilities and Debt Ratios.
        5. Asset Valuations.
        6. Key Financial Metrics.
        7. Profit Margins.
        8. Cash Flow Analysis.
        9. Earnings Per Share.
        10. Dividend Payouts.
        11. Operating Income.
        12. Capital Expenditures.
        13. Forecasts and Projections.
        14. Financial Risks.
        15. Investment Opportunities.
        Report Content: 
        {file_content}
        """,
        "marketing_plan": f"""
        Analyze this marketing plan and provide insights in valid JSON:
        1. Campaign Objectives.
        2. Target Audience Demographics.
        3. Product Positioning.
        4. Brand Messaging.
        5. Advertising Channels.
        6. Budget Allocation.
        7. Expected ROI.
        8. Performance KPIs.
        9. Competitive Analysis.
        10. Market Segmentation.
        11. Influencer Strategies.
        12. Content Plan.
        13. Customer Acquisition Strategies.
        14. Retention Tactics.
        15. Risk Mitigation Strategies.
        Marketing Plan Content: 
        {file_content}
        """,
        # Additional Prompts for the remaining 27 agents
        "meeting_minutes": f"""
        Analyze these meeting minutes and provide insights in valid JSON:
        1. Key Decisions.
        2. Action Items.
        3. Deadlines.
        4. Participants and Roles.
        5. Discussion Topics.
        6. Voting Results.
        7. Future Agenda Items.
        8. Time Allocation.
        9. Conflict Resolutions.
        10. Updates from Previous Meetings.
        11. Next Meeting Date.
        12. Performance Highlights.
        13. Announcements.
        14. Follow-ups.
        15. Stakeholder Impact.
        Meeting Content: 
        {file_content}
        """,
        "case_study": f"""
        Analyze this case study and provide insights in valid JSON:
        1. Problem Statement.
        2. Solution Implemented.
        3. Key Outcomes.
        4. Lessons Learned.
        5. Cost Analysis.
        6. Timeline.
        7. Stakeholder Impact.
        8. Success Metrics.
        9. Risks Mitigated.
        10. Scalability.
        11. Innovation.
        12. Competitive Edge.
        13. Industry Relevance.
        14. Future Opportunities.
        15. Challenges Faced.
        Case Study Content: 
        {file_content}
        """,
        # Define prompts for additional file types
        "research_paper": f"""
        Analyze the following research paper and provide insights in valid JSON:
        1. Research Objective.
        2. Hypotheses.
        3. Methodology.
        4. Key Findings.
        5. Data Analysis.
        6. Sample Size.
        7. Limitations.
        8. Citations.
        9. Implications.
        10. Future Work.
        11. Statistical Significance.
        12. Ethical Considerations.
        13. Key Graphs and Data Points.
        14. Abstract.
        15. Conclusions.
        Paper Content: 
        {file_content}
        """,
    }
    return prompts.get(file_type, "").strip()

