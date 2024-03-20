const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
const {
  SearchIndexClient,
  SearchClient,
  AzureKeyCredential,
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
  try {
    const docs = await generateDocumentEmbeddings();
    await uploadDocuments(docs);
  } catch (err) {
    console.log(
      `Failed to generate embeddings and upload documents to ACS: ${err.message}`
    );
  }

  // Examples of different types of vector searches
  await doPureVectorSearch();
  await doPureVectorSearchMultilingual();
  await doCrossFieldVectorSearch();
  await doVectorSearchWithFilter();
  await doHybridSearch();
  await doSemanticHybridSearch();
}

async function uploadJsonToBlob() {
    const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_ACCESS_KEY;
    const containerName = process.env.AZURE_STORAGE_BLOB_CONTAINER_NAME;
    const blobName = "testformat.json"; // Replace with your actual file name
    const filePath = "../data/testformat.json"; // Adjust the path according to your file's location
  
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

async function generateDocumentEmbeddings() {
    console.log("Reading JSON from Azure Blob Storage...");

    const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_ACCESS_KEY;
    const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
    const blobServiceClient = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        sharedKeyCredential
    );

    const containerName = process.env.AZURE_STORAGE_BLOB_CONTAINER_NAME;
    const blobName = process.env.AZURE_STORAGE_BLOB_FILE_NAME; // Adjust this to your JSON file name

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);
    const downloadBlockBlobResponse = await blobClient.download(0);
    const buffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
    const jsonData = JSON.parse(buffer.toString());

    // Ensure jsonData is an array
    if (!Array.isArray(jsonData)) {
        jsonData = [jsonData]; // Convert to array if it's a single object
    }

    console.log("JSON Data:", jsonData);

    console.log(jsonData.title)

    console.log("Generating embeddings with Azure OpenAI...");
    const outputData = [];
    for (const item of jsonData) {
        console.log(item.title);
        const titleEmbeddings = await generateEmbeddings(item.title);
        const contentEmbeddings = await generateEmbeddings(item.content);
        outputData.push({
            ...item,
            titleVector: titleEmbeddings,
            contentVector: contentEmbeddings,
        });
    }

    console.log("Embeddings generated successfully.");
    
    fs.writeFileSync("../output/blobVectors.json", JSON.stringify(outputData));

    return outputData;

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

async function doPureVectorSearch() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  const query = "What is cryptocurrency?";
  const response = await searchClient.search(undefined, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["contentVector"],
    }],
    select: ["title", "content", "category"],
  });

  console.log(`\nPure vector search results:`);
  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Score: ${result.score}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);
    console.log(`\n`);
  }
}

async function doPureVectorSearchMultilingual() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  // e.g 'tools for software development' in Dutch)
  const query = "tools voor softwareontwikkeling";
  const response = await searchClient.search(undefined, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["contentVector"],
    }],
    select: ["title", "content", "category"],
  });

  console.log(`\nPure vector search (multilingual) results:`);
  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Score: ${result.score}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);
    console.log(`\n`);
  }
}

async function doCrossFieldVectorSearch() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  const query = "What are product steps?";
  const response = await searchClient.search(undefined, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["titleVector", "contentVector"],
    }],
    select: ["title", "content", "category"],
  });

  console.log(`\nCross-field vector search results:`);
  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Score: ${result.score}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);
    console.log(`\n`);
  }
}

async function doVectorSearchWithFilter() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  const query = "What are the next product step?";
  const response = await searchClient.search(undefined, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["contentVector"],
    }],
    filter: "category eq 'Developer Tools'",
    select: ["title", "content", "category"],
  });

  console.log(`\nVector search with filter results:`);
  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Score: ${result.score}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);
    console.log(`\n`);
  }
}

async function doHybridSearch() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  const query = "product step";
  const response = await searchClient.search(query, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["contentVector"],
    }],
    select: ["title", "content", "category"],
    top: 3,
  });

  console.log(`\nHybrid search results:`);
  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Score: ${result.score}`);
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);
    console.log(`\n`);
  }
}

async function doSemanticHybridSearch() {
  const searchServiceEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchServiceApiKey = process.env.AZURE_SEARCH_ADMIN_KEY;
  const searchIndexName = process.env.AZURE_SEARCH_INDEX_NAME;

  const searchClient = new SearchClient(
    searchServiceEndpoint,
    searchIndexName,
    new AzureKeyCredential(searchServiceApiKey)
  );

  const query = "what is dium?";
  const response = await searchClient.search(query, {
    vectorQueries: [{
      kind: "vector",
      vector: await generateEmbeddings(query),
      kNearestNeighborsCount: 3,
      fields: ["contentVector"],
    }],
    select: ["title", "content", "category"],
    queryType: "semantic",
    top: 3,
    semanticSearchOptions: {
      answers: {
          answerType: "extractive",
          count: 3
      },
      captions:{
          captionType: "extractive",
          count: 3
      },
      configurationName: "my-semantic-config",
    }
  });

  console.log(`\nSemantic Hybrid search results:`);
  for await (const answer of response.answers) {
    if (answer.highlights) {
      console.log(`Semantic answer: ${answer.highlights}`);
    } else {
      console.log(`Semantic answer: ${answer.text}`);
    }

    console.log(`Semantic answer score: ${answer.score}\n`);
  }

  for await (const result of response.results) {
    console.log(`Title: ${result.document.title}`);
    console.log(`Reranker Score: ${result.rerankerScore}`); // Reranker score is the semantic score
    console.log(`Content: ${result.document.content}`);
    console.log(`Category: ${result.document.category}`);

    if (result.captions) {
      const caption = result.captions[0];
      if (caption.highlights) {
        console.log(`Caption: ${caption.highlights}`);
      } else {
        console.log(`Caption: ${caption.text}`);
      }
    }

    console.log(`\n`);
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
      readableStream.on("data", (data) => {
        chunks.push(data instanceof Buffer ? data : Buffer.from(data));
      });
      readableStream.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      readableStream.on("error", reject);
    });
}

main();
