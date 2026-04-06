#!/usr/bin/env python3
"""
Script to rename all Make references to Make across the SparqMake repository.
"""

import os
import re
from pathlib import Path

# Configuration
REPO_PATH = Path('/sessions/upbeat-keen-johnson/sparqmake-repo')
TEXT_EXTENSIONS = {
    '.md', '.js', '.ts', '.tsx', '.jsx', '.json', '.css',
    '.env', '.yml', '.yaml', '.mjs', '.cjs', '.xml', '.html',
    '.py', '.sh', '.bash', '.txt'
}
SKIP_DIRS = {'node_modules', '.git', '.next', 'build', 'dist', '.venv', 'venv'}
BINARY_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip'}

# Replacement patterns: order matters (longer patterns first to avoid partial replacements)
REPLACEMENTS = [
    (r'\bSparqForge\b', 'SparqMake'),
    (r'\bSPARQFORGE\b', 'SPARQMAKE'),
    (r'\bsparqforge\b', 'sparqmake'),
    (r'\bSparq Make\b', 'Sparq Make'),
    (r'\bsparq-forge\b', 'sparq-make'),
    (r'\bsparq_forge\b', 'sparq_make'),
    (r'\bForge\b', 'Make'),  # Generic "Make" to "Make"
]

def should_process_file(file_path):
    """Check if file should be processed."""
    name = file_path.name

    # Skip if binary extension
    if file_path.suffix.lower() in BINARY_EXTENSIONS:
        return False

    # Skip if no extension but doesn't look like a text file
    if file_path.suffix == '' and not (name.startswith('.') or name in ['Makefile', 'README', 'LICENSE']):
        return False

    # Process text files
    if file_path.suffix.lower() in TEXT_EXTENSIONS:
        return True

    # Process files starting with .env or config files without extension
    if name.startswith('.env') or name in ['Makefile', 'README', 'LICENSE', 'CHANGELOG']:
        return True

    return False

def is_skip_dir(dir_path):
    """Check if directory should be skipped."""
    return any(part in SKIP_DIRS for part in dir_path.parts)

def process_file(file_path):
    """Process a single file with replacements."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        original_content = content

        # Apply all replacements
        for pattern, replacement in REPLACEMENTS:
            content = re.sub(pattern, replacement, content)

        # Write back if changed
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False

def rename_files():
    """Rename files with 'forge' or 'Make' in their names."""
    renamed = []

    for root, dirs, files in os.walk(REPO_PATH):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for file_name in files:
            if 'forge' in file_name.lower() and not any(file_name.endswith(ext) for ext in BINARY_EXTENSIONS):
                file_path = Path(root) / file_name

                # Create new name
                new_name = file_name.replace('Make', 'Make').replace('forge', 'make')

                if new_name != file_name:
                    new_path = Path(root) / new_name
                    try:
                        file_path.rename(new_path)
                        renamed.append((str(file_path), str(new_path)))
                        print(f"Renamed: {file_name} -> {new_name}")
                    except Exception as e:
                        print(f"Error renaming {file_path}: {e}")

    return renamed

def main():
    """Main execution function."""
    print("Starting SparqMake to SparqMake rename process...")
    print(f"Repository path: {REPO_PATH}\n")

    # Step 1: Process all text files
    print("Step 1: Processing text files for content replacements...")
    processed_count = 0
    total_count = 0

    for root, dirs, files in os.walk(REPO_PATH):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for file_name in files:
            file_path = Path(root) / file_name
            total_count += 1

            if should_process_file(file_path):
                if process_file(file_path):
                    processed_count += 1
                    print(f"  Modified: {file_path.relative_to(REPO_PATH)}")

    print(f"Processed {processed_count} files out of {total_count} total files\n")

    # Step 2: Rename files with 'forge' in the name
    print("Step 2: Renaming files with 'forge' in the filename...")
    renamed = rename_files()
    print(f"Renamed {len(renamed)} files\n")

    print("Rename process completed successfully!")

if __name__ == '__main__':
    main()
