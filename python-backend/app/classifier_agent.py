import os
import re
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

# Load pre-trained ML model
model_path = 'file_classifier_model.pkl'
model = joblib.load(model_path) if os.path.exists(model_path) else None
if not model:
    print(f"Debug: Model not found at {model_path}. Pattern-based classification will be used exclusively.")

# Pattern-based classification
patterns = {
    "legal_contract": ["agreement", "jurisdiction", "liability"],
    "financial_report": ["balance sheet", "net income", "cash flow"],
    "marketing_plan": ["campaign", "audience", "performance"],
    "meeting_minutes": ["agenda", "minutes", "action items"],
    "case_study": ["solution", "outcomes", "problem"],
    "research_paper": ["abstract", "methodology", "results"]
}

def score_patterns(content):
    scores = {nature: sum(1 for keyword in keywords if re.search(rf'\b{keyword}\b', content, re.IGNORECASE)) 
              for nature, keywords in patterns.items()}
    return scores

def ml_predict(content):
    if not model:
        return None, 0
    try:
        vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        content_vectorized = vectorizer.fit_transform([content])
        prediction = model.predict(content_vectorized)
        confidence = max(model.predict_proba(content_vectorized)[0])
        print(f"Debug: ML prediction: {prediction[0]}, Confidence: {confidence}")
        return prediction[0], confidence
    except Exception as e:
        print(f"Debug: Error during ML prediction - {e}")
        return None, 0

def classify_file(content):
    # Pattern-based scoring
    pattern_scores = score_patterns(content)
    best_pattern_match = max(pattern_scores, key=pattern_scores.get)
    confidence = pattern_scores[best_pattern_match] / len(patterns[best_pattern_match]) if len(patterns[best_pattern_match]) > 0 else 0
    print(f"Debug: Best pattern match: {best_pattern_match}, Confidence: {confidence}")

    # ML-based prediction
    ml_nature, ml_confidence = ml_predict(content)

    # Decision based on higher confidence
    if ml_confidence > confidence:
        return ml_nature, ml_confidence
    return best_pattern_match, confidence
