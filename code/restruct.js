const fs = require("fs");
 
function reformatAndSaveData(sourceFilePath, targetFilePath, title) {
  fs.readFile(sourceFilePath, "utf8", (err, data) => {
    if (err) {
      console.error("An error occurred:", err);
      return;
    }
 
    try {
      const jsonData = JSON.parse(data);
      // Convert the whole JSON object to a string
      let contentString = JSON.stringify(jsonData, null, 4);
 
      // Remove special characters
      contentString = contentString.replace(/[\n\\"]/g, "");
 
      const reformattedData = {
        ID: jsonData.id.toString(),
        Title: title,
        Content: contentString,
      };
 
      fs.writeFile(
        targetFilePath,
        JSON.stringify(reformattedData, null, 4),
        (err) => {
          if (err) {
            console.error("An error occurred:", err);
            return;
          }
          console.log("File has been saved.");
        }
      );
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
    }
  });
}
 
// Example usage
const sourceFilePath = "../data/originalcompanydata.json"; // Adjusted for a .txt source file
const targetFilePath = "../output/formatted.json"; // Target file path
const title = "Your Manual Title Here"; // Update this with the title you wish to use
 
reformatAndSaveData(sourceFilePath, targetFilePath, title);