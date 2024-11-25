from neo4j import GraphDatabase
from datetime import datetime
import base64
import traceback

class Neo4jAgent:
    def __init__(self):
        try:
            self.driver = GraphDatabase.driver(
                "neo4j+ssc://247c892e.databases.neo4j.io",
                auth=("neo4j", "F3w0JbgMHQ-Mb4UPWHrNWqCD_H_hmwazKXuNY9KH8NM")
            )
            print("[DEBUG] Connected to Neo4j successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to connect to Neo4j: {str(e)}")
            self.driver = None
            raise

    def close(self):
        if self.driver:
            self.driver.close()
            print("[DEBUG] Neo4j connection closed.")

    def store_memory(self, insights):
        if not self.driver:
            print("[ERROR] No active Neo4j driver connection.")
            return

        try:
            with self.driver.session() as session:
                session.write_transaction(self._create_memory_graph, insights)
                print("[DEBUG] Memory graph created successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to store memory: {str(e)}")
            traceback.print_exc()

    @staticmethod
    def _create_memory_graph(tx, insights):
        print("[DEBUG] Creating memory graph...")

        try:
            # Save the memory node
            memory_query = """
            MERGE (m:Memory {file_name: $file_name, content: $content})
            ON CREATE SET m.created_at = $timestamp
            RETURN m
            """
            memory_result = tx.run(memory_query, file_name=insights["file_name"],
                                   content=insights["content"], timestamp=datetime.now())
            memory_node = memory_result.single()["m"]
            print(f"[DEBUG] Memory node created: {memory_node}")

            # Save entities
            for entity in insights.get("entities", []):
                entity_query = """
                MERGE (e:Entity {name: $name, type: $type})
                ON CREATE SET e.created_at = $timestamp
                RETURN e
                """
                tx.run(entity_query, name=entity["text"], type=entity["label"], timestamp=datetime.now())

            # Save relationships
            for rel in insights.get("relationships", []):
                for obj in rel.get("object", []):
                    relationship_query = """
                    MATCH (e1:Entity {name: $subject}), (e2:Entity {name: $object})
                    MERGE (e1)-[:RELATED {type: $type, context: $context, timestamp: $timestamp}]->(e2)
                    """
                    tx.run(relationship_query, subject=rel["subject"], object=obj, type=rel["type"],
                           context=rel["context"], timestamp=datetime.now())
            print("[DEBUG] Entities and relationships saved successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to create memory graph: {str(e)}")
            traceback.print_exc()

    def fetch_all_data(self):
        if not self.driver:
            print("[ERROR] No active Neo4j driver connection.")
            return []

        try:
            with self.driver.session() as session:
                query = """
                MATCH (n)
                OPTIONAL MATCH (n)-[r]->(m)
                RETURN n, collect(r) as relationships, collect(m) as connected_nodes
                """
                result = session.run(query)
                data = []
                for record in result:
                    node = record.get("n")
                    relationships = record.get("relationships", [])
                    connected_nodes = record.get("connected_nodes", [])

                    # Structure the data
                    data.append({
                        "node": {
                            "labels": list(node.labels) if node else [],
                            "properties": dict(node) if node else {}
                        },
                        "relationships": [
                            {
                                "type": rel.type,
                                "start_node_id": rel.start_node.id,
                                "end_node_id": rel.end_node.id,
                                "properties": dict(rel)
                            } for rel in relationships if rel
                        ],
                        "connected_nodes": [
                            {
                                "labels": list(conn_node.labels) if conn_node else [],
                                "properties": dict(conn_node) if conn_node else {}
                            } for conn_node in connected_nodes if conn_node
                        ]
                    })
                print("[DEBUG] Data fetched successfully from Neo4j.")
                return data
        except Exception as e:
            print(f"[ERROR] Failed to fetch data: {str(e)}")
            traceback.print_exc()
            return []

    def process_file(self, content_base64):
        try:
            # Ensure the base64 string is properly padded
            while len(content_base64) % 4 != 0:
                content_base64 += '='

            # Save the base64 decoded content to a temporary file
            with open('temp_file', 'wb') as temp_file:
                temp_file.write(base64.b64decode(content_base64))
            print("[DEBUG] File processed and saved temporarily.")
        except Exception as e:
            print(f"[ERROR] Error decoding base64 content: {str(e)}")
            traceback.print_exc()
            raise

# Usage example:
# neo4j_agent = Neo4jAgent()
# insights = {
#     "file_name": "example.pdf",
#     "content": "Sample content",
#     "entities": [{"text": "Entity1", "label": "Type1"}, {"text": "Entity2", "label": "Type2"}],
#     "relationships": [{"subject": "Entity1", "object": ["Entity2"], "type": "RELATED", "context": "Sample context"}]
# }
# neo4j_agent.store_memory(insights)
# neo4j_agent.close()
