const fs = require("fs");
const csv = require("csv-parser");
const process = require("process");

process.chdir(__dirname);

// Input CSV file path
const inputFilePath = "starlink_elset_for_2024_02_01.csv";

// Output TXT file path
const outputFilePath = "ase.txt";

// Create a writable stream for the output file
const outputStream = fs.createWriteStream(outputFilePath);

// Read the CSV file and process it
fs.createReadStream(inputFilePath)
  .pipe(csv())
  .on("data", (row) => {
    // Extract the necessary columns
    const satName = row.SATNAME;
    const { line1 } = row;
    const { line2 } = row;

    // Format the data
    const formattedData = `${satName}\n${line1}\n${line2}\n`;

    // Write the formatted data to the output file
    outputStream.write(formattedData);
  })
  .on("end", () => {
    console.log("CSV file successfully processed and converted to TXT.");
    outputStream.end();
  })
  .on("error", (error) => {
    console.error("Error processing CSV file:", error);
  });
