import React from 'react';

interface AnimatedButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  variant?: 'primary' | 'success' | 'danger' | 'glass';
  isLoading?: boolean;
}

export const AnimatedButton: React.FC<AnimatedButtonProps> = ({ 
  icon, 
  label, 
  variant = 'primary', 
  isLoading = false,
  className = '',
  disabled,
  ...props 
}) => {
  
  const getVariantClasses = () => {
    switch (variant) {
      case 'success':
        return 'bg-emerald-600 hover:bg-emerald-700 text-white';
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-700 text-white';
      case 'glass':
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700';
      case 'primary':
      default:
        return 'bg-indigo-600 hover:bg-indigo-700 text-white';
    }
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`
        flex items-center justify-center gap-2
        rounded-xl px-4 py-2.5
        font-bold text-sm
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${getVariantClasses()}
        ${className}
      `}
      {...props}
    >
      <div className={`${isLoading ? 'animate-spin' : ''}`}>
        {icon}
      </div>
      <span className="whitespace-nowrap">
          {isLoading ? '...' : label}
      </span>
    </button>
  );
};