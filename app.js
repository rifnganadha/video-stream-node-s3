require("dotenv").config();

const express = require('express');
const path = require("path");
const fs = require("fs");
const AWS = require('aws-sdk');
const ffmpeg = require("fluent-ffmpeg");

const app = express();

const s3Config = {
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION,
    bucket: process.env.S3_BUCKET,
}

const s3 = new AWS.S3({
    endpoint: s3Config.endpoint,
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
    region: s3Config.region,
    s3ForcePathStyle: true, // Needed for Vultr compatibility
    signatureVersion: "v4", // Ensure correct signing version
    httpOptions: {
        timeout: 30000, // 30 seconds for overall request
        connectTimeout: 10000, // 10 seconds to establish connection
    },
});


app.get("/", function (req, res) {
    let indexPath = path.join(__dirname, "index.html");
    let indexHtml = fs.readFileSync(indexPath, 'utf8');

    // Replace a placeholder with the actual environment variable
    indexHtml = indexHtml.replace('__VIDEO_STREAM_URL__', process.env.VIDEO_STREAM_URL || '/video-local/timer.m3u8');

    res.send(indexHtml);
});

// Serve HLS files from the 'output' local directory
app.use("/video-local", express.static(path.join(__dirname, "output")));

app.get('/convert', (req, res) => {
    // Input and output paths
    const inputFile = "video/timer.mp4"; // MP4 input file
    const outputDir = "output"; // Directory for HLS files
    const outputFile = path.join(outputDir, "timer.m3u8");

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert MP4 to HLS
    ffmpeg(inputFile)
        .outputOptions([
            "-codec: copy",          // Copy codecs (no re-encoding)
            "-start_number 0",       // Start segment numbering at 0
            "-hls_time 10",          // 10 sec per segment
            "-hls_list_size 0",      // No segment removal
            "-f hls"                 // Output format: HLS
        ])
        .output(outputFile)
        .on("end", () => res.json("✅ Conversion completed!"))
        .on("error", (err) => res.status(500).json("❌ Error:", err.message))
        .run();
})

app.get('/upload-to-s3', async (req, res) => {
    const folderPath = './output'; // Local folder
    const s3NewFolder = `videos/${Date.now()}`; // New folder in S3

    // Function to recursively get all files (supports subfolders)
    const getAllFiles = (dir) => {
        let files = [];
        fs.readdirSync(dir).forEach((file) => {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                files = [...files, ...getAllFiles(fullPath)]; // Recursive call
            } else {
                files.push(fullPath);
            }
        });
        return files;
    };
    
    // Upload a single file
    const uploadFile = async (filePath) => {
        const fileStream = fs.createReadStream(filePath);
        const relativePath = path.relative(folderPath, filePath); // Keep subfolder structure
        const s3Key = `${s3NewFolder}/${relativePath}`; // Upload to new folder in S3
        const mimetype = relativePath.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/MP2T"
    
        const params = {
            Bucket: s3Config.bucket,
            Key: s3Key,
            Body: fileStream,
            ACL: 'public-read',
            ContentType: mimetype
        };
    
        return s3.upload(params).promise();
    };
    
    // Upload all files in parallel
    const uploadFolder = async () => {
        try {
            const files = getAllFiles(folderPath);
            const uploadPromises = files.map(uploadFile);
    
        await Promise.all(uploadPromises);
            res.json(`✅ All files uploaded to S3 folder: ${s3NewFolder}/`);
        } catch (err) {
            res.status(500).json("❌ Error uploading files:", err);
        }
    };
    
    // Start upload
    uploadFolder();
})

// Serve HLS files (m3u8 + .ts) from s3
app.get("/stream/:subfolder/:filename", async (req, res) => {
    const hlsFolder = 'videos'
    const subfolder = req.params.subfolder
    const fileName = req.params.filename;
    const s3Key = `${hlsFolder}/${subfolder}/${fileName}`;
  
    const params = {
        Bucket: s3Config.bucket,
        Key: s3Key
    };
  
    try {
      const stream = s3.getObject(params).createReadStream()
      res.setHeader("Content-Type", fileName.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/MP2T");
      stream.pipe(res);
    } catch (err) {
      res.status(404).json({ error: "File not found" });
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));