/**
 * Demo API key generation for CyborgDB.
 *
 * This module provides functionality to generate temporary demo API keys
 * from the CyborgDB demo API service.
 */

/**
 * Generate a temporary demo API key from the CyborgDB demo API service.
 *
 * This function generates a temporary API key that can be used for demo purposes.
 * The endpoint can be configured via the CYBORGDB_DEMO_ENDPOINT environment variable.
 *
 * @param description - Optional description for the demo API key.
 *                      Defaults to "Temporary demo API key" if not provided.
 * @returns Promise resolving to the generated demo API key.
 * @throws Error if the demo API key could not be generated.
 *
 * @example
 * ```typescript
 * import { getDemoApiKey, Client } from 'cyborgdb';
 * const demoKey = await getDemoApiKey();
 * const client = new Client("https://your-instance.com", demoKey);
 * ```
 */
export async function getDemoApiKey(description?: string): Promise<string> {
  // Use environment variable if set, otherwise use default endpoint
  const endpoint =
    process.env.CYBORGDB_DEMO_ENDPOINT ||
    "https://api.cyborgdb.co/v1/api-key/manage/create-demo-key";

  // Set default description if not provided
  const finalDescription = description ?? "Temporary demo API key";

  // Prepare the request payload
  const payload = {
    description: finalDescription,
  };

  try {
    // Make the POST request (no authentication required)
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Check if request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Parse the response
    const data = await response.json();

    // Extract the API key
    const apiKey = data.apiKey;
    if (!apiKey) {
      const errorMsg = "Demo API key not found in response.";
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Log expiration info if available
    const expiresAt = data.expiresAt;
    if (expiresAt) {
      // Calculate time left until expiration
      const expiresAtDate = new Date(expiresAt * 1000);
      const now = new Date();
      const timeLeftMs = expiresAtDate.getTime() - now.getTime();

      // Convert to human-readable format
      const seconds = Math.floor(timeLeftMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      let timeLeftStr = "";
      if (days > 0) {
        timeLeftStr = `${days} day${days > 1 ? "s" : ""}, ${hours % 24} hour${hours % 24 !== 1 ? "s" : ""}`;
      } else if (hours > 0) {
        timeLeftStr = `${hours} hour${hours > 1 ? "s" : ""}, ${minutes % 60} minute${minutes % 60 !== 1 ? "s" : ""}`;
      } else if (minutes > 0) {
        timeLeftStr = `${minutes} minute${minutes > 1 ? "s" : ""}, ${seconds % 60} second${seconds % 60 !== 1 ? "s" : ""}`;
      } else {
        timeLeftStr = `${seconds} second${seconds !== 1 ? "s" : ""}`;
      }

      console.info(`Demo API key will expire in ${timeLeftStr}`);
    }

    return apiKey;
  } catch (error) {
    const errorMsg = `Failed to generate demo API key: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}
