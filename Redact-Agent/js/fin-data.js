document.addEventListener('DOMContentLoaded', () => {
    // Smooth scrolling & active link indicator for navbar items
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Intersection Observer to update active nav state on scroll
    const sections = document.querySelectorAll('.content-section');
    const observerOptions = {
        root: null,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const targetId = entry.target.getAttribute('id');
                navItems.forEach(item => {
                    if (item.getAttribute('href') === `#${targetId}`) {
                        navItems.forEach(nav => nav.classList.remove('active'));
                        item.classList.add('active');
                    }
                });
            }
        });
    }, observerOptions);

    sections.forEach(section => observer.observe(section));

    // Chart.js: Scaling & Cost Growth Comparison Visualization
    const ctx = document.getElementById('scalingChart').getContext('2d');
    
    const scalingChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Lean Setup', 'Comfortable Setup'],
            datasets: [
                {
                    label: '1,000 Users (USD/yr)',
                    data: [2800, 4200],
                    backgroundColor: '#38bdf8',
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: '10,000 Users (USD/yr)',
                    data: [5700, 8700],
                    backgroundColor: '#0284c7',
                    borderRadius: 6,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: {
                            family: 'Inter',
                            size: 12
                        },
                        color: '#0f172a'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: $${context.raw.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: {
                            family: 'Inter'
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#e2e8f0'
                    },
                    ticks: {
                        font: {
                            family: 'Inter'
                        },
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
});