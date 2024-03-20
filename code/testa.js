const axios = require("axios");
const dotenv = require("dotenv");
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
const { SearchIndexClient, SearchClient, AzureKeyCredential } = require("@azure/search-documents");
const pdfParse = require("pdf-parse");

dotenv.config({ path: "../.env" });

async function main() {
    try {
        await createSearchIndex();
        const docs = await generateDocumentEmbeddings();
        await uploadDocuments(docs);
        
        // Example search queries
        await performSearch("example search query here", "title"); // Adjust based on your needs
    } catch (err) {
        console.error(`Error: ${err.message}`);
    }
}

async function generateDocumentEmbeddings() {
    console.log("Reading PDF from Azure Blob Storage...");

    // Initialize Azure Blob Service Client
    const blobServiceClient = new BlobServiceClient(`https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, new StorageSharedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT_NAME, process.env.AZURE_STORAGE_ACCOUNT_ACCESS_KEY));

    const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_STORAGE_BLOB_CONTAINER_NAME);
    const blobClient = containerClient.getBlobClient(process.env.AZURE_STORAGE_BLOB_FILE_NAME);
    const downloadBlockBlobResponse = await blobClient.download(0);
    const pdfBuffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);

    console.log("Extracting text from PDF...");
    const pdfData = await pdfParse(pdfBuffer);
    const pdfText = pdfData.text;

    console.log("Generating embeddings with Azure OpenAI...");
    // Generate embeddings for the extracted text
    const contentEmbeddings = await generateEmbeddings(pdfText);

    // Prepare the document structure for Azure Cognitive Search
    return [{
        id: "1", // Unique ID for the document
        title: "Dium: NFT-Based Copyright Management for Artists", // Example title
        content: pdfText, // The extracted text from PDF
        category: "Cryptocurrency, Art", // Example category
        contentVector: contentEmbeddings // Embeddings
    }];
}

async function createSearchIndex() {
    const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
    const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;
  
    const indexClient = new SearchIndexClient(
      searchServiceEndpoint,
      new AzureKeyCredential(searchServiceApiKey)
    );
  
    const index = {
      name: searchIndexName,
      fields: [
        {
          name: "id",
          type: "Edm.String",
          key: true,
          sortable: true,
          filterable: true,
          facetable: true,
        },
        { name: "title", type: "Edm.String", searchable: true },
        { name: "content", type: "Edm.String", searchable: true },
        {
          name: "category",
          type: "Edm.String",
          filterable: true,
          searchable: true,
        },
        {
          name: "titleVector",
          type: "Collection(Edm.Single)",
          searchable: true,
          vectorSearchDimensions: 1536,
          vectorSearchProfileName: "myHnswProfile",
        },
        {
          name: "contentVector",
          type: "Collection(Edm.Single)",
          searchable: true,
          vectorSearchDimensions: 1536,
          vectorSearchProfileName: "myHnswProfile",
        },
      ],
      vectorSearch: {
        algorithms: [{ name: "myHnswAlgorithm", kind: "hnsw" }],
        profiles: [
          {
            name: "myHnswProfile",
            algorithmConfigurationName: "myHnswAlgorithm",
          },
        ],
      },
      semanticSearch: {
        configurations: [
          {
            name: "my-semantic-config",
            prioritizedFields: {
              contentFields: [{ name: "content" }],
              keywordsFields: [{ name: "category" }],
              titleField: {
                name: "title",
              },
            },
          },
        ],
      },
    };
  
    console.log("Creating ACS index...");
    await indexClient.createOrUpdateIndex(index);
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

  async function performSearch(query, field) {
    const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
    const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

    const searchClient = new SearchClient(
        searchServiceEndpoint,
        searchIndexName,
        new AzureKeyCredential(searchServiceApiKey)
    );

    console.log(`Searching for '${query}' in '${field}'...`);

    const options = {
        searchFields: [field], // Specify the field to search in
        select: ["id", "title", "content", "category"], // Specify the fields to retrieve
        top: 5, // Limit the number of results
    };

    try {
        const searchResults = await searchClient.search(query, options);
        
        // Output the search results
        console.log("Search Results:");
        for await (const result of searchResults.results) {
            console.log(`ID: ${result.document.id}`);
            console.log(`Title: ${result.document.title}`);
            if (result.document.content) {
                // Output a snippet of the content field to avoid dumping a lot of text to the console
                console.log(`Content: ${result.document.content.substring(0, 100)}...`);
            }
            console.log(`Category: ${result.document.category}`);
            console.log(""); // Add a newline for readability
        }
    } catch (error) {
        console.error(`Error performing search: ${error.message}`);
    }
}


async function generateEmbeddings(text) {
    // Set Azure OpenAI API parameters from environment variables
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiBase = `https://${process.env.AZURE_OPENAI_SERVICE_NAME}.openai.azure.com`;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  
    const response = await axios.post(
      `${apiBase}/openai/deployments/${deploymentName}/embeddings?api-version=${apiVersion}`,
      {
        input: text,
        engine: "text-embedding-ada-002",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
      }
    );
  
    const embeddings = response.data.data[0].embedding;
    return embeddings;
  }

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
        readableStream.on("end", () => resolve(Buffer.concat(chunks)));
        readableStream.on("error", reject);
    });
}

main();
