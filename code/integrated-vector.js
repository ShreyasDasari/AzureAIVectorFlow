const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
const {
  SearchIndexClient,
  SearchIndexerClient,
  SearchClient,
  AzureKeyCredential,
  SearchIndexerDataSourceConnection,
  SearchIndexerDataContainer
} = require("@azure/search-documents");

async function main() {
    // Load environment variables from .env file
    dotenv.config({ path: "../.env" });
  
    // First, upload the JSON file to Azure Blob Storage
    try {
        await uploadJsonToBlob();
        console.log("JSON file uploaded successfully.");
    } catch (error) {
        console.error("Failed to upload JSON file:", error);
        return;
    }
  
    // Create Azure AI Search index
    try {
      await createSearchIndex();
    } catch (err) {
      console.log(`Failed to create ACS index: ${err.message}`);
    }
  
    // Generate document embeddings and upload to Azure AI Search
    // try {
    //   const docs = await generateDocumentEmbeddings();
    //   await uploadDocuments(docs);
    // } catch (err) {
    //   console.log(
    //     `Failed to generate embeddings and upload documents to ACS: ${err.message}`
    //   );
    // }

    try {
        await createOrUpdateBlobDataSource();
        console.log("Blob data source created or updated successfully.");
      } catch (error) {
        console.error("Failed to create or update blob data source:", error);
      }

    try {
        await createOrUpdateSkillset();
        console.log("Skillset created or updated successfully.");
     } catch (error) {
        console.error("Failed to create or update skillset:", error);
    }

    try {
      await createOrUpdateIndexer();
      console.log('Indexer created or updated successfully.');
    } catch (error) {
      console.error('Failed to create or update indexer:', error);
    }

    try {
      await performVectorSearch();
      console.log('Vector search performed successfully.');
    } catch (error) {
      console.error('Failed to perform vector search:', error);
    }


}

async function uploadJsonToBlob() {
    const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_ACCESS_KEY;
    const containerName = process.env.AZURE_STORAGE_BLOB_CONTAINER_NAME;
    const blobName = "betterpulltest.pdf"; // Replace with your actual file name
    const filePath = "../data/betterpulltest.pdf"; // Adjust the path according to your file's location
  
    const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      sharedKeyCredential
    );
  
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  
    // Read the JSON file content
    const fileContent = fs.readFileSync(filePath, "utf8");
  
    console.log(`Uploading file ${blobName} to container ${containerName}...`);
    
    // Upload the file content to the blob
    await blockBlobClient.upload(fileContent, fileContent.length, {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });
  
    console.log(`${blobName} uploaded successfully.`);
}

async function createOrUpdateBlobDataSource() {
    const indexerClient = new SearchIndexerClient(
        process.env.AZURE_SEARCH_ENDPOINT,
        new AzureKeyCredential(process.env.AZURE_SEARCH_ADMIN_KEY)
    );

    const dataSourceName = `${process.env.AZURE_SEARCH_INDEX_NAME}-blob`;
    const dataSourceConnection = {
        name: dataSourceName,
        type: "azureblob",
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
        container: { name: process.env.AZURE_STORAGE_BLOB_CONTAINER_NAME }
    };

    const dataSource = await indexerClient.createOrUpdateDataSourceConnection(dataSourceConnection);
    console.log(`Data source '${dataSource.name}' created or updated`);
}

async function createSearchIndex() {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX_NAME;

    const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));

    const fields = [
        { name: "parent_id", type: "Edm.String", sortable: true, filterable: true, facetable: true },
        { name: "title", type: "Edm.String", searchable: true },
        { name: "chunk_id", type: "Edm.String", key: true, sortable: true, filterable: true, searchable: true, facetable: true, analyzerName: "keyword" },
        { name: "chunk", type: "Edm.String", searchable: true },
        { name: "category", type: "Edm.String", filterable: true, searchable: true },
        { name: "vector", type: "Collection(Edm.Single)", searchable: true, vectorSearchDimensions: 1536, vectorSearchProfileName: "myHnswProfile" }
    ];

    // Assume vector search and semantic search configurations are defined here
    const vectorSearch = {
        // Vector search configuration details
        algorithms: [{ name: "myHnswAlgorithm", kind: "hnsw" }],
        profiles: [
          {
            name: "myHnswProfile",
            algorithmConfigurationName: "myHnswAlgorithm",
          }, 
        ],
    };

    const semanticSearch = {
        // Semantic search configuration details
        configurations: [
            {
              name: "my-semantic-config",
              prioritizedFields: {
                contentFields: [{ name: "chunk" }],
                keywordsFields: [{ name: "category" }],
                titleField: {
                  name: "title",
                },
              },
            },
          ],
    };

    const index = {
        name: indexName,
        fields: fields,
        vectorSearch: vectorSearch,
        semanticSearch: semanticSearch
    };

    console.log("Creating search index...");
    await indexClient.createOrUpdateIndex(index);
    console.log(`${indexName} index created or updated successfully.`);
}

async function uploadDocuments(docs) {
    const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
    const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;
  
    const searchClient = new SearchClient(
      searchServiceEndpoint,
      searchIndexName,
      new AzureKeyCredential(searchServiceApiKey)
    );
  
    console.log("Uploading documents to ACS index...");
    await searchClient.uploadDocuments(docs);
}

// Creating Skillsets
async function createOrUpdateSkillset() {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const apiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
    const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
    const azureOpenaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const azureOpenaiDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    const azureOpenaiKey = process.env.AZURE_OPENAI_API_KEY;

    const indexerClient = new SearchIndexerClient(endpoint, new AzureKeyCredential(apiKey));
    const skillsetName = `${indexName}-skillset`;

    // Define the split skill
    let splitSkill = {
        name: "Split skill",
        description: "Split skill to chunk documents",
        odatatype: "#Microsoft.Skills.Text.SplitSkill",
        textSplitMode: "pages",
        context: "/document",
        maximumPageLength: 2000,
        pageOverlapLength: 500,
        inputs: [
            { name: "text", source: "/document/content" }
        ],
        outputs: [
            { name: "textItems", targetName: "pages" }
        ]
    };

    // Define the embedding skill
    let embeddingSkill = {
        name: "Azure OpenAI Embedding skill",
        description: "Skill to generate embeddings via Azure OpenAI",
        odatatype: "#Microsoft.Skills.Custom.AzureOpenAIEmbeddingSkill",
        context: "/document/pages/*",
        resourceUri: azureOpenaiEndpoint,
        deploymentId: azureOpenaiDeployment,
        apiKey: azureOpenaiKey,
        inputs: [
            { name: "text", source: "/document/pages/*" }
        ],
        outputs: [
            { name: "embedding", targetName: "vector" }
        ]
    };

    // Define the skillset
    let skillset = {
        name: skillsetName,
        description: "Skillset to chunk documents and generating embeddings",
        skills: [splitSkill]
        // Add other necessary properties for the skillset
    };

    console.log(`Creating or updating skillset: ${skillsetName}...`);
    await indexerClient.createOrUpdateSkillset(skillset); // Make sure this method exists or find the equivalent
    console.log(`Skillset '${skillsetName}' created or updated successfully.`);
}

async function createOrUpdateIndexer() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
  const dataSourceName = `${indexName}-blob`; // Assuming the data source name follows this pattern
  const skillsetName = `${indexName}-skillset`;
 
  const indexerClient = new SearchIndexerClient(endpoint, new AzureKeyCredential(apiKey));
 
  const indexerName = `${indexName}-indexer`;
  
  const indexer = {
      name: indexerName,
      description: "Indexer to index documents and generate embeddings",
      skillsetName: skillsetName,
      targetIndexName: indexName,
      dataSourceName: dataSourceName,
      fieldMappings: [
          { sourceFieldName: "metadata_storage_name", targetFieldName: "title" }
      ]
  };
 
  console.log(`Creating or updating indexer: ${indexerName}...`);
  await indexerClient.createOrUpdateIndexer(indexer);
  console.log(`Indexer '${indexerName}' created or updated successfully.`);
 
  // Run the indexer
  console.log(`Running indexer: ${indexerName}...`);
  await indexerClient.runIndexer(indexerName);
  console.log(`Indexer '${indexerName}' is running.`);
}
 
async function performVectorSearch() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME;
  const apiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
 
  const searchClient = new SearchClient(
      endpoint,
      indexName,
      new AzureKeyCredential(apiKey)
  );
 
  const query = "Which is more comprehensive, Northwind Health Plus vs Northwind Standard?";
 
  // Assuming the 'generateEmbeddings' function is defined and returns the vector representation of the query
  // const vector = await generateEmbeddings(query);
 
  // For pure vector search, replace `searchText` with `null` and use `vectorQuery`
  const results = await searchClient.search({
      searchText: null, // No text search in this case, only vector
      filter: null, // Add filters if needed
      select: ["parent_id", "chunk_id", "chunk"],
      top: 1,
      // Uncomment the following line if you have a function to generate vector for the query
      // vectorQuery: { vector, k: 1, scoringProfile: "myHnswProfile" }
  });
 
  for await (const result of results.results) {
      console.log(`parent_id: ${result.parent_id}`);
      console.log(`chunk_id: ${result.chunk_id}`);
      console.log(`Score: ${result['@search.score']}`);
      console.log(`Content: ${result.chunk}`);
  }
}



    
main();
   