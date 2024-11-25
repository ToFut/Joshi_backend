from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from neo4j import GraphDatabase
from neo4j_graphrag.experimental.components.pdf_loader import PdfLoader
from neo4j_graphrag.experimental.components.text_splitters.fixed_size_splitter import FixedSizeSplitter
from neo4j_graphrag.experimental.components.embedder import TextChunkEmbedder
from neo4j_graphrag.embeddings.openai import OpenAIEmbeddings
from neo4j_graphrag.experimental.components.entity_relation_extractor import LLMEntityRelationExtractor
from neo4j_graphrag.llm.openai_llm import OpenAILLM
from neo4j_graphrag.experimental.components.lexical_graph import LexicalGraphBuilder
from neo4j_graphrag.experimental.components.kg_writer import Neo4jWriter
from docx import Document
import textract
import base64
import tempfile
import shutil
import traceback
from datetime import datetime
import logging
from app.file_processor import extract_text_from_file

# Configure logging
logging.basicConfig(level=logging.DEBUG, format="%(asctime)s [%(levelname)s] %(message)s")

# Initialize FastAPI
app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Neo4j Configuration
NEO4J_URI='neo4j+ssc://247c892e.databases.neo4j.io'
NEO4J_USER='neo4j'
NEO4J_PASSWORD='F3w0JbgMHQ-Mb4UPWHrNWqCD_H_hmwazKXuNY9KH8NM'

try:
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    logging.info("Neo4j driver initialized successfully.")
except Exception as e:
    logging.error("Failed to initialize Neo4j driver:", e)
    raise e


# Pydantic model for file upload
class FileRequest(BaseModel):
    fileName: str
    content: str


# Helper function for Base64 padding
def ensure_base64_padding(content: str) -> str:
    while len(content) % 4 != 0:
        content += '='
    return content


@app.post("/process-file")
async def process_file(file_request: FileRequest):
    file_name = file_request.fileName
    content_base64 = file_request.content
    temp_dir = None

    logging.debug("Received file for processing: %s", file_name)

    try:
        # Decode base64 content
        logging.debug("Decoding base64 content...")
        content = base64.b64decode(ensure_base64_padding(content_base64))

        # Save content to a temporary file
        temp_dir = tempfile.mkdtemp()
        temp_file_path = Path(temp_dir) / file_name
        with open(temp_file_path, "wb") as f:
            f.write(content)
        logging.debug("Temporary file saved at: %s", temp_file_path)

        # Process file and extract text
        logging.debug("Extracting text from file...")
        extracted_text = extract_text_from_file(file_name, temp_file_path)

        if not extracted_text:
            raise HTTPException(status_code=500, detail="Failed to extract text from file")
        logging.debug("Text extraction completed. Length: %d characters", len(extracted_text))

        # Split and embed text
        logging.debug("Splitting text into chunks...")
        splitter = FixedSizeSplitter(chunk_size=1000, chunk_overlap=100)
        chunks = splitter.run(text=extracted_text)
        logging.debug("Text split into %d chunks.", len(chunks))

        logging.debug("Embedding text chunks...")
        embedder = TextChunkEmbedder(embedder=OpenAIEmbeddings())
        embedded_chunks = embedder.run(text_chunks=chunks)
        logging.debug("Embedding completed.")

        # Extract entities and relationships
        logging.debug("Extracting entities and relationships...")
        llm = OpenAILLM(model_name="gpt-4", model_params={"max_tokens": 1000})
        extractor = LLMEntityRelationExtractor(llm=llm, schema=None)
        entities, relationships = extractor.run(chunks=embedded_chunks)
        logging.debug("Entities extracted: %d, Relationships extracted: %d", len(entities), len(relationships))

        # Build and write graph to Neo4j
        logging.debug("Building lexical graph...")
        lexical_graph_builder = LexicalGraphBuilder()
        lexical_graph = lexical_graph_builder.run(
            text_chunks=embedded_chunks,
            document_info={"file_name": file_name, "uploaded_at": str(datetime.now())}
        )
        logging.debug("Lexical graph built. Nodes: %d, Relationships: %d", len(lexical_graph.nodes), len(lexical_graph.relationships))

        logging.debug("Writing to Neo4j...")
        with driver.session() as session:
            writer = Neo4jWriter(session)
            writer.run(lexical_graph=lexical_graph, entities=entities, relationships=relationships)
        logging.info("Knowledge graph successfully written to Neo4j.")

        # Clean up temporary files
        logging.debug("Cleaning up temporary files...")
        shutil.rmtree(temp_dir)

        # Return success response
        return JSONResponse({
            "message": "File processed successfully",
            "file_name": file_name,
            "nodes_count": len(lexical_graph.nodes),
            "relationships_count": len(lexical_graph.relationships),
        })

    except base64.binascii.Error as e:
        logging.error("Invalid Base64 content: %s", e)
        raise HTTPException(status_code=400, detail="Invalid Base64 content")
    except Exception as e:
        logging.error("Error processing file: %s", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")
    finally:
        if temp_dir:
            logging.debug("Removing temporary directory: %s", temp_dir)
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
