**To:** [Recipient Name / Designation]
[Department / Office]
[University Name]

**From:** [Your Name]
[Program / Department]
[Student ID]
[Date]

**Subject:** Request for DGX Server Access — Smart India Hackathon (SIH) Project

Respected Sir/Madam,

Our team has been **selected for the Smart India Hackathon (SIH)**, and we are developing a Chrome extension powered by a self-hosted Large Language Model as our solution. To build, test, and demonstrate the project, we request access to the **DGX server** that you kindly offered to provide login credentials for.

### Project in Brief
A Chrome extension that sends user text to a self-hosted LLM (**Qwen2.5-14B-Instruct**) through a FastAPI backend and returns processed responses. Hosting the model in-house on the DGX is essential as we cannot rely on paid third-party APIs during development and the hackathon demonstration.

### GPU & Processing Power Required
- **GPU:** 1× NVIDIA A100 (40 GB) or equivalent slice on the DGX — sufficient to run the 14B model with quantization and serve multiple concurrent users smoothly.
- **CPU:** 12+ cores allocated to our workload
- **RAM:** 64 GB
- **Storage:** 500 GB for model weights, logs, and project files

A DGX node easily accommodates these requirements, and we are happy to work within whatever partition/quota is assigned to us.

### Expected Load
- **Average request rate:** ~**2–5 requests per second** during active testing
- **Peak:** up to **10 requests per second** during the hackathon demonstration
- Request size is small (text only), so network bandwidth needs are minimal — standard campus connectivity is sufficient.

### Access Request
- **DGX login credentials** for the following team members: [Team Member Names]
- SSH access to the allocated environment
- Duration: until the conclusion of the SIH hackathon ([expected end date])

We assure you the resources will be used responsibly and strictly for the hackathon project. Kindly grant us access at your earliest convenience so we can begin deployment and testing without delay.

Thank you for your support in enabling our participation in SIH.

Sincerely,

[Your Name]
[Contact Email] | [Phone]
[Supervisor Name & Signature, if required]
