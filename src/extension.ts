import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as crypto from 'crypto';

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('localizeimg.downloadImages', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }

        const document = editor.document;
        const html = document.getText();
        const $ = cheerio.load(html);

        const imgTags = $('img');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const imagesDir = path.join(workspacePath, 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir);
        }

        const edits: { oldSrc: string, newSrc: string }[] = [];
        
        for (let i = 0; i < imgTags.length; i++) {
            const img = imgTags[i];
            const src = $(img).attr('src');

            if (src && /^https?:\/\//.test(src)) {
                try {
                    vscode.window.showInformationMessage(`Processing: ${src}`);
                    
                    // Create a hash of the full URL to ensure uniqueness
                    const hash = crypto.createHash('md5').update(src).digest('hex').substring(0, 10);
                    
                    // Get the image content and content type
                    const response = await axios.get(src, { 
                        responseType: 'arraybuffer',
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                        }
                    });
                    
                    // Determine the file extension from the content type
                    let ext = '.jpg'; // Default extension
                    const contentType = response.headers['content-type'];
                    
                    if (contentType) {
                        if (contentType.includes('png')) ext = '.png';
                        else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg';
                        else if (contentType.includes('gif')) ext = '.gif';
                        else if (contentType.includes('webp')) ext = '.webp';
                        else if (contentType.includes('svg')) ext = '.svg';
                        else if (contentType.includes('bmp')) ext = '.bmp';
                        else if (contentType.includes('tiff')) ext = '.tiff';
                    } else {
                        // Try to get extension from URL path as fallback
                        try {
                            const urlObj = new URL(src);
                            const pathName = urlObj.pathname;
                            const pathParts = pathName.split('/').pop()?.split('?')[0] || '';
                            const pathExt = path.extname(pathParts).toLowerCase();
                            if (pathExt && /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)/.test(pathExt)) {
                                ext = pathExt;
                            }
                        } catch (err) {
                            console.error('Error parsing URL:', err);
                            // Fallback to default .jpg if URL parsing fails
                        }
                    }
                    
                    // Ensure we have an extension
                    if (!ext.startsWith('.')) {
                        ext = '.' + ext;
                    }
                    
                    const filename = `image_${hash}${ext}`;
                    const localPath = path.join(imagesDir, filename);
                    const relativePath = path.relative(path.dirname(document.uri.fsPath), localPath).replace(/\\/g, '/');

                    // Write the image data to the local file
                    fs.writeFileSync(localPath, Buffer.from(response.data));

                    edits.push({ oldSrc: src, newSrc: relativePath });
                    vscode.window.showInformationMessage(`Downloaded: ${filename}`);
                } catch (err) {
                    console.error('Error downloading image:', err);
                    vscode.window.showWarningMessage(`Failed to download: ${src}`);
                }
            }
        }

        // Apply all the edits at once
        if (edits.length > 0) {
            try {
                const edit = new vscode.WorkspaceEdit();
                
                // Get the document content
                let documentText = document.getText();
                
                // Sort edits by URL length (longest first) to avoid partial replacements
                edits.sort((a, b) => b.oldSrc.length - a.oldSrc.length);
                
                // Replace each URL
                for (const { oldSrc, newSrc } of edits) {
                    // Simple search and replace all occurrences of the exact URL
                    // This works better than regex for complex URLs with special characters
                    const urlRegex = new RegExp(`src=["']${escapeRegExp(oldSrc)}["']`, 'g');
                    documentText = documentText.replace(urlRegex, `src="${newSrc}"`);
                }
                
                // Replace the entire document
                edit.replace(
                    document.uri,
                    new vscode.Range(
                        0, 0,
                        document.lineCount, document.lineAt(document.lineCount - 1).text.length
                    ),
                    documentText
                );
                
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage(`Localized ${edits.length} images.`);
            } catch (err) {
                console.error('Error applying edits:', err);
                vscode.window.showErrorMessage('Failed to replace image URLs in document.');
            }
        } else {
            vscode.window.showInformationMessage('No remote images found to localize.');
        }
    });

    context.subscriptions.push(disposable);
}

// Helper function to escape special characters in regex
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate() {}